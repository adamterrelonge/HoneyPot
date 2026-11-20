//! Resident policy engine: the topology and rules are loaded into WASM memory once and compiled
//! to integer ids, then each tick sends only `u32` queries and gets `i32` results back.
//!
//! Why: the JSON batch interface (`decide_batch_json`) is correct but 3-4x slower than the
//! TypeScript engine, because serialising every request costs more than the rule check itself.
//! Here no strings cross the boundary per query.
//!
//! Result codes (one `i32` per query):
//!   `>= 0` the index of the deciding rule (its action says allowed or blocked),
//!   `SAME_ZONE` (allowed), `DEFAULT_DENY`, `DEFAULT_ALLOW`.
//! The host rebuilds the player-facing reason text from the code and the rule name.

use crate::policy::{Endpoint, Rule};
use std::collections::HashMap;

pub const SAME_ZONE: i32 = -1;
pub const DEFAULT_DENY: i32 = -2;
pub const DEFAULT_ALLOW: i32 = -3;

/// A service id that is not in the table: matches only `any` rules.
pub const OTHER_SERVICE: u32 = u32::MAX;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Sel {
    Any,
    Kind(u32),
    Zone(u32),
    Node(u32),
    Tag(u32),
    Never,
}

struct CompiledRule {
    from: Sel,
    to: Sel,
    any_service: bool,
    services: Vec<u32>,
}

struct Ep {
    node: u32,
    zone: u32,
    kind: u32,
    outside: bool,
    public: bool,
    tags: Vec<u32>,
}

pub struct Resident {
    rules: Vec<CompiledRule>,
    endpoints: Vec<Ep>,
}

#[derive(Default)]
struct Interner(HashMap<String, u32>);

impl Interner {
    fn id(&mut self, s: &str) -> u32 {
        let next = self.0.len() as u32;
        *self.0.entry(s.to_owned()).or_insert(next)
    }
}

impl Resident {
    /// Compiles rules and endpoints. `services` is the host's service table: query service ids
    /// index into it.
    pub fn new(rules: &[Rule], endpoints: &[Endpoint], services: &[String]) -> Resident {
        let (mut kinds, mut zones, mut nodes, mut tags) = (
            Interner::default(),
            Interner::default(),
            Interner::default(),
            Interner::default(),
        );
        let service_ids: HashMap<&str, u32> = services
            .iter()
            .enumerate()
            .map(|(i, s)| (s.as_str(), i as u32))
            .collect();

        let eps: Vec<Ep> = endpoints
            .iter()
            .map(|e| Ep {
                node: nodes.id(&e.node.id),
                zone: zones.id(&e.zone.id),
                kind: kinds.id(&e.zone.kind),
                outside: matches!(e.zone.kind.as_str(), "internet" | "cloud"),
                public: matches!(e.zone.kind.as_str(), "internet" | "cloud" | "edge"),
                tags: e.node.tags.iter().map(|t| tags.id(t)).collect(),
            })
            .collect();

        // Selectors naming something absent from the topology can never match: `Never`, without
        // growing the tables (a lookup, not an insert).
        let compile = |selector: &str| -> Sel {
            if selector == "any" {
                return Sel::Any;
            }
            let (ty, reference) = crate::policy::split_selector(selector);
            let lookup = |t: &Interner| t.0.get(reference).copied();
            match ty {
                "kind" => lookup(&kinds).map_or(Sel::Never, Sel::Kind),
                "zone" => lookup(&zones).map_or(Sel::Never, Sel::Zone),
                "node" => lookup(&nodes).map_or(Sel::Never, Sel::Node),
                "tag" => lookup(&tags).map_or(Sel::Never, Sel::Tag),
                _ => Sel::Never,
            }
        };

        // Disabled rules are dropped here; `ResidentHandle` maps indexes back to the host's list.
        let rules = rules
            .iter()
            .filter(|r| r.enabled)
            .map(|r| CompiledRule {
                from: compile(&r.from),
                to: compile(&r.to),
                any_service: r.services.iter().any(|s| s == "any"),
                services: r
                    .services
                    .iter()
                    .filter_map(|s| service_ids.get(s.as_str()).copied())
                    .collect(),
            })
            .collect();
        Resident {
            rules,
            endpoints: eps,
        }
    }

    fn hit(sel: Sel, e: &Ep) -> bool {
        match sel {
            Sel::Any => true,
            Sel::Kind(k) => e.kind == k,
            Sel::Zone(z) => e.zone == z,
            Sel::Node(n) => e.node == n,
            Sel::Tag(t) => e.tags.contains(&t),
            Sel::Never => false,
        }
    }

    /// Decides one query. Returns the index among *enabled* rules; see `ResidentHandle` for the
    /// mapping back to the host's rule list.
    pub fn decide(&self, from: u32, to: u32, service: u32) -> i32 {
        let (Some(f), Some(t)) = (
            self.endpoints.get(from as usize),
            self.endpoints.get(to as usize),
        ) else {
            return DEFAULT_DENY;
        };
        if f.zone == t.zone {
            return SAME_ZONE;
        }
        for (i, r) in self.rules.iter().enumerate() {
            if !r.any_service && (service == OTHER_SERVICE || !r.services.contains(&service)) {
                continue;
            }
            if Self::hit(r.from, f) && Self::hit(r.to, t) {
                return i as i32;
            }
        }
        if f.outside && !t.public {
            DEFAULT_DENY
        } else {
            DEFAULT_ALLOW
        }
    }
}

/// A `Resident` plus the map from enabled-rule index to the host's rule index.
pub struct ResidentHandle {
    engine: Resident,
    rule_index: Vec<i32>,
}

impl ResidentHandle {
    pub fn new(rules: &[Rule], endpoints: &[Endpoint], services: &[String]) -> ResidentHandle {
        let rule_index = rules
            .iter()
            .enumerate()
            .filter(|(_, r)| r.enabled)
            .map(|(i, _)| i as i32)
            .collect();
        ResidentHandle {
            engine: Resident::new(rules, endpoints, services),
            rule_index,
        }
    }

    /// `queries` holds `[from, to, service]` triples; one result code per triple goes to `out`.
    pub fn decide_all(&self, queries: &[u32], out: &mut [i32]) {
        for (q, slot) in queries.as_chunks::<3>().0.iter().zip(out.iter_mut()) {
            let code = self.engine.decide(q[0], q[1], q[2]);
            *slot = if code >= 0 {
                self.rule_index[code as usize]
            } else {
                code
            };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::{decide, Action, Node, Zone};

    fn ep(node: &str, tags: &[&str], zone: &str, kind: &str) -> Endpoint {
        Endpoint {
            node: Node {
                id: node.into(),
                tags: tags.iter().map(|t| t.to_string()).collect(),
            },
            zone: Zone {
                id: zone.into(),
                kind: kind.into(),
            },
        }
    }

    fn rule(
        id: &str,
        from: &str,
        to: &str,
        services: &[&str],
        action: Action,
        enabled: bool,
    ) -> Rule {
        Rule {
            id: id.into(),
            name: id.into(),
            from: from.into(),
            to: to.into(),
            services: services.iter().map(|s| s.to_string()).collect(),
            action,
            enabled,
        }
    }

    /// Every (from, to, service) combination agrees with the reference `policy::decide`.
    #[test]
    fn agrees_with_reference_on_every_combination() {
        let endpoints = vec![
            ep("pc", &["byod"], "z-office", "office"),
            ep("pc2", &[], "z-office", "office"),
            ep("db", &[], "z-server", "server"),
            ep("inet", &[], "z-internet", "internet"),
            ep("portal", &["public"], "z-edge", "edge"),
            ep("guest-phone", &["guest"], "z-guest", "guest"),
        ];
        let rules = vec![
            rule("off", "any", "any", &["any"], Action::Deny, false),
            rule(
                "guests",
                "tag:guest",
                "kind:server",
                &["any"],
                Action::Deny,
                true,
            ),
            rule(
                "sql",
                "kind:office",
                "node:db",
                &["practice-db"],
                Action::Allow,
                true,
            ),
            rule(
                "ghost",
                "zone:z-nowhere",
                "any",
                &["any"],
                Action::Deny,
                true,
            ),
            rule(
                "byod",
                "tag:byod",
                "kind:server",
                &["files", "web"],
                Action::Deny,
                true,
            ),
            rule(
                "web-in",
                "kind:internet",
                "tag:public",
                &["web"],
                Action::Allow,
                true,
            ),
            rule("bad", "office", "any", &["any"], Action::Deny, true),
        ];
        let services: Vec<String> = ["files", "web", "practice-db", "dns"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let h = ResidentHandle::new(&rules, &endpoints, &services);

        let mut queries = Vec::new();
        let mut expected = Vec::new();
        for f in 0..endpoints.len() {
            for t in 0..endpoints.len() {
                for (sid, svc) in services
                    .iter()
                    .map(String::as_str)
                    .chain(["unlisted"])
                    .enumerate()
                {
                    let sid = if svc == "unlisted" {
                        OTHER_SERVICE
                    } else {
                        sid as u32
                    };
                    queries.extend([f as u32, t as u32, sid]);
                    let d = decide(&rules, &endpoints[f], &endpoints[t], svc);
                    expected.push(match d.rule {
                        Some(id) => rules.iter().position(|r| r.id == id).unwrap() as i32,
                        None if d.reason.starts_with("Same zone") => SAME_ZONE,
                        None if d.allowed => DEFAULT_ALLOW,
                        None => DEFAULT_DENY,
                    });
                }
            }
        }
        let mut out = vec![0; expected.len()];
        h.decide_all(&queries, &mut out);
        assert_eq!(out, expected);
    }
}
