/**
 * Loader for the Rust/WebAssembly policy engine (`engine-rs`, draft). Not wired into the
 * simulation yet: the TypeScript `decide` in `src/engine/policy` stays the reference, and
 * `policy-wasm.test.ts` proves both agree before any switch-over.
 *
 * Lives outside `src/engine` because WebAssembly and TextEncoder are host APIs, which the pure
 * engine is not allowed to touch (tsconfig.engine.json).
 *
 * Build the module with `npm run build:wasm`.
 */
import type { Rule } from "../engine/model";
import type { Endpoint } from "../engine/policy/policy";

export interface WasmDecision {
  allowed: boolean;
  /** Id of the deciding rule, or null for same-zone and default-policy decisions. */
  rule: string | null;
  reason: string;
}

/** `[fromIndex, toIndex, service]`, indexes into the endpoint list. */
export type PolicyQuery = [from: number, to: number, service: string];

/** Result codes from the resident interface (mirrors `engine-rs/src/resident.rs`). */
export const SAME_ZONE = -1;
export const DEFAULT_DENY = -2;
export const DEFAULT_ALLOW = -3;
/** Service id for a service missing from the table given to `prepare`: matches only `any` rules. */
export const OTHER_SERVICE = 0xffffffff;

/**
 * A topology loaded into WASM memory. Queries and results are typed arrays, so no strings cross
 * the boundary per decision. Codes `>= 0` are indexes into the rules given to `prepare`.
 */
export interface ResidentPolicy {
  /** `queries` holds `[from, to, serviceId]` triples; returns one code per triple. */
  decide(queries: Uint32Array): Int32Array;
  /** Rebuilds the full decision (with the player-facing reason) from a code. */
  explain(code: number): WasmDecision;
}

export interface PolicyWasm {
  /** JSON in, JSON out: simple, but slower than the TypeScript engine (see build.md). */
  decideBatch(rules: readonly Rule[], endpoints: readonly Endpoint[], queries: readonly PolicyQuery[]): WasmDecision[];
  /** Loads rules and endpoints once (replacing any earlier load); `services` is the service-id table. */
  prepare(rules: readonly Rule[], endpoints: readonly Endpoint[], services: readonly string[]): ResidentPolicy;
}

interface Exports {
  memory: WebAssembly.Memory;
  hp_alloc(len: number): number;
  hp_free(ptr: number, len: number): void;
  hp_result_len(): number;
  hp_decide_batch(ptr: number, len: number): number;
  hp_load(ptr: number, len: number, errOut: number): number;
  hp_decide_resident(queries: number, n: number, out: number): number;
}

/** Only the fields the Rust side reads cross the boundary, which keeps the JSON small. */
const slimEndpoint = (e: Endpoint) => ({ node: { id: e.node.id, tags: e.node.tags }, zone: { id: e.zone.id, kind: e.zone.kind } });

export async function loadPolicyWasm(bytes: BufferSource): Promise<PolicyWasm> {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const x = instance.exports as unknown as Exports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const call = (fn: (ptr: number, len: number) => number, request: unknown): unknown => {
    const input = encoder.encode(JSON.stringify(request));
    const inPtr = x.hp_alloc(input.length);
    new Uint8Array(x.memory.buffer, inPtr, input.length).set(input);
    const outPtr = fn(inPtr, input.length);
    const outLen = x.hp_result_len();
    // Read before freeing; memory.buffer may have been replaced if the module grew its memory.
    const text = decoder.decode(new Uint8Array(x.memory.buffer, outPtr, outLen));
    x.hp_free(inPtr, input.length);
    x.hp_free(outPtr, outLen);
    const result = JSON.parse(text) as unknown;
    if (result && typeof result === "object" && "error" in result) throw new Error(`engine-rs: ${String(result.error)}`);
    return result;
  };

  const prepare = (rules: readonly Rule[], endpoints: readonly Endpoint[], services: readonly string[]): ResidentPolicy => {
    const input = encoder.encode(JSON.stringify({ rules, endpoints: endpoints.map(slimEndpoint), services }));
    const inPtr = x.hp_alloc(input.length);
    const errPtr = x.hp_alloc(4);
    new Uint8Array(x.memory.buffer, inPtr, input.length).set(input);
    const status = x.hp_load(inPtr, input.length, errPtr);
    x.hp_free(inPtr, input.length);
    if (status !== 0) {
      const outPtr = new Uint32Array(x.memory.buffer, errPtr, 1)[0]!;
      const outLen = x.hp_result_len();
      const text = decoder.decode(new Uint8Array(x.memory.buffer, outPtr, outLen));
      x.hp_free(outPtr, outLen);
      x.hp_free(errPtr, 4);
      throw new Error(`engine-rs: ${(JSON.parse(text) as { error: string }).error}`);
    }
    x.hp_free(errPtr, 4);

    // Query/result buffers are reused across calls and only grow.
    let capacity = 0;
    let qPtr = 0;
    let oPtr = 0;
    const ensure = (n: number) => {
      if (n <= capacity) return;
      if (capacity) {
        x.hp_free(qPtr, capacity * 12);
        x.hp_free(oPtr, capacity * 4);
      }
      capacity = Math.max(n, capacity * 2, 1024);
      qPtr = x.hp_alloc(capacity * 12);
      oPtr = x.hp_alloc(capacity * 4);
    };

    return {
      decide(queries) {
        const n = queries.length / 3;
        ensure(n);
        new Uint32Array(x.memory.buffer, qPtr, n * 3).set(queries);
        if (x.hp_decide_resident(qPtr, n, oPtr) !== 0) throw new Error("engine-rs: no topology loaded");
        return new Int32Array(x.memory.buffer, oPtr, n).slice();
      },
      explain(code) {
        if (code === SAME_ZONE) return { allowed: true, rule: null, reason: "Same zone: not filtered by the firewall" };
        if (code === DEFAULT_DENY) return { allowed: false, rule: null, reason: "Default policy: inbound from the internet is denied" };
        if (code === DEFAULT_ALLOW) return { allowed: true, rule: null, reason: "Default policy: allowed (no rule matched)" };
        const r = rules[code]!;
        const allowed = r.action === "allow";
        return { allowed, rule: r.id, reason: `${allowed ? "Allowed" : "Blocked"} by rule “${r.name}”` };
      },
    };
  };

  return {
    decideBatch: (rules, endpoints, queries) =>
      call(x.hp_decide_batch, { rules, endpoints: endpoints.map(slimEndpoint), queries }) as WasmDecision[],
    prepare,
  };
}
