//! Honeypot engine hot paths in Rust, compiled to WebAssembly (draft).
//!
//! The TypeScript engine (`src/engine`) remains the reference implementation. Modules are ported
//! here one at a time and must give identical results, checked by parity tests on the TS side.
//! Ported so far: firewall policy evaluation (`policy`).
//!
//! ## WASM interface
//! A deliberately small C-style ABI, so no `wasm-bindgen`/`wasm-pack` toolchain is needed:
//! the host copies UTF-8 JSON into memory from `hp_alloc`, calls a function, then reads
//! `hp_result_len()` bytes of JSON from the returned pointer and frees both buffers with `hp_free`.
//! Errors come back as `{"error": "..."}`.
//!
//! Batching matters: one call evaluates many flows, so the JSON boundary is crossed once per
//! simulation tick rather than once per flow.

pub mod policy;
pub mod resident;

use serde::Deserialize;
use serde_json::json;
use std::cell::RefCell;
use std::sync::atomic::{AtomicUsize, Ordering};

static RESULT_LEN: AtomicUsize = AtomicUsize::new(0);

thread_local! {
    /// The loaded topology for the resident interface. WASM here is single-threaded.
    static RESIDENT: RefCell<Option<resident::ResidentHandle>> = const { RefCell::new(None) };
}

#[derive(Deserialize)]
struct LoadRequest {
    rules: Vec<policy::Rule>,
    endpoints: Vec<policy::Endpoint>,
    services: Vec<String>,
}

/// Loads (or replaces) the resident topology from JSON. Returns an error message on failure.
pub fn load_resident_json(input: &str) -> Result<(), String> {
    let req: LoadRequest = serde_json::from_str(input).map_err(|e| format!("bad request: {e}"))?;
    let handle = resident::ResidentHandle::new(&req.rules, &req.endpoints, &req.services);
    RESIDENT.with(|r| *r.borrow_mut() = Some(handle));
    Ok(())
}

/// One policy evaluation request: endpoints are sent once and referenced by index.
#[derive(Deserialize)]
pub struct BatchRequest {
    pub rules: Vec<policy::Rule>,
    pub endpoints: Vec<policy::Endpoint>,
    /// `[fromIndex, toIndex, service]`.
    pub queries: Vec<(usize, usize, String)>,
}

/// Evaluates a batch request given as JSON and returns the decisions as a JSON array (in query order).
pub fn decide_batch_json(input: &str) -> String {
    let req: BatchRequest = match serde_json::from_str(input) {
        Ok(r) => r,
        Err(e) => return json!({ "error": format!("bad request: {e}") }).to_string(),
    };
    let mut out = Vec::with_capacity(req.queries.len());
    for (i, (from, to, service)) in req.queries.iter().enumerate() {
        let (Some(f), Some(t)) = (req.endpoints.get(*from), req.endpoints.get(*to)) else {
            return json!({ "error": format!("query {i}: endpoint index out of range") })
                .to_string();
        };
        out.push(policy::decide(&req.rules, f, t, service));
    }
    serde_json::to_string(&out).unwrap_or_else(|e| json!({ "error": e.to_string() }).to_string())
}

fn leak_string(s: String) -> *mut u8 {
    let mut bytes = s.into_bytes().into_boxed_slice();
    RESULT_LEN.store(bytes.len(), Ordering::Relaxed);
    let ptr = bytes.as_mut_ptr();
    std::mem::forget(bytes);
    ptr
}

/// Allocates `len` bytes for the host to write a request into.
#[no_mangle]
pub extern "C" fn hp_alloc(len: usize) -> *mut u8 {
    let mut buf = vec![0u8; len].into_boxed_slice();
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// Frees a buffer from `hp_alloc` or a result pointer.
///
/// # Safety
/// `ptr`/`len` must come from `hp_alloc` or from a result plus `hp_result_len`, and be freed once.
#[no_mangle]
pub unsafe extern "C" fn hp_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
    }
}

/// Length in bytes of the most recent result.
#[no_mangle]
pub extern "C" fn hp_result_len() -> usize {
    RESULT_LEN.load(Ordering::Relaxed)
}

/// Policy decisions for a batch (see `BatchRequest`).
///
/// # Safety
/// `ptr` must point to `len` bytes of UTF-8 written by the host into an `hp_alloc` buffer.
#[no_mangle]
pub unsafe extern "C" fn hp_decide_batch(ptr: *const u8, len: usize) -> *mut u8 {
    let bytes = std::slice::from_raw_parts(ptr, len);
    let out = match std::str::from_utf8(bytes) {
        Ok(s) => decide_batch_json(s),
        Err(_) => json!({ "error": "request is not UTF-8" }).to_string(),
    };
    leak_string(out)
}

/// Loads the resident topology (`{rules, endpoints, services}` JSON). Returns 0 on success;
/// otherwise -1, and the error JSON is the result (read it with `hp_result_len`, then free it).
///
/// # Safety
/// `ptr` must point to `len` bytes written by the host into an `hp_alloc` buffer.
#[no_mangle]
pub unsafe extern "C" fn hp_load(ptr: *const u8, len: usize, err_out: *mut u32) -> i32 {
    let bytes = std::slice::from_raw_parts(ptr, len);
    let result = std::str::from_utf8(bytes)
        .map_err(|_| "request is not UTF-8".to_string())
        .and_then(load_resident_json);
    match result {
        Ok(()) => 0,
        Err(e) => {
            *err_out = leak_string(json!({ "error": e }).to_string()) as u32;
            -1
        }
    }
}

/// Decides `n` queries against the resident topology. `queries` holds `n` `[from, to, service]`
/// `u32` triples; `out` receives `n` `i32` codes (see `resident`). Returns -1 if nothing is loaded.
///
/// # Safety
/// `queries` must hold `3 * n` u32s and `out` room for `n` i32s, both from `hp_alloc`.
#[no_mangle]
pub unsafe extern "C" fn hp_decide_resident(queries: *const u32, n: usize, out: *mut i32) -> i32 {
    let q = std::slice::from_raw_parts(queries, n * 3);
    let o = std::slice::from_raw_parts_mut(out, n);
    RESIDENT.with(|r| match r.borrow().as_ref() {
        Some(h) => {
            h.decide_all(q, o);
            0
        }
        None => -1,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batch_round_trip() {
        let req = r#"{
            "rules": [{"id":"g","name":"Guests out","from":"kind:guest","to":"kind:server","services":["any"],"action":"deny"}],
            "endpoints": [
                {"node":{"id":"phone","tags":[]},"zone":{"id":"z-guest","kind":"guest"}},
                {"node":{"id":"db","tags":[]},"zone":{"id":"z-server","kind":"server"}}
            ],
            "queries": [[0,1,"files"],[1,0,"files"]]
        }"#;
        let out: serde_json::Value = serde_json::from_str(&decide_batch_json(req)).unwrap();
        assert_eq!(out[0]["allowed"], false);
        assert_eq!(out[0]["rule"], "g");
        assert_eq!(out[1]["allowed"], true);
        assert_eq!(out[1]["rule"], serde_json::Value::Null);
    }

    #[test]
    fn errors_are_reported_not_panicked() {
        assert!(decide_batch_json("not json").contains("bad request"));
        let req = r#"{"rules":[],"endpoints":[],"queries":[[0,1,"x"]]}"#;
        assert!(decide_batch_json(req).contains("out of range"));
    }
}
