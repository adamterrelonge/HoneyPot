//! Firewall policy evaluation: a line-for-line port of `src/engine/policy/policy.ts` (`matches`,
//! `decide`). The TypeScript version is the reference. `src/wasm/policy-wasm.test.ts` checks that
//! both give identical decisions (allowed, rule and reason text) on generated businesses.
//!
//! Rules are zone-to-zone and evaluated once per flow:
//!   - traffic inside one zone is never filtered;
//!   - otherwise the first enabled rule whose services, `from` and `to` all match decides;
//!   - if none match, inbound from the internet or a cloud service into a private zone is denied,
//!     and everything else is allowed.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Allow,
    Deny,
}

/// A firewall rule. Extra fields in the JSON are ignored.
#[derive(Debug, Clone, Deserialize)]
pub struct Rule {
    pub id: String,
    pub name: String,
    pub from: String,
    pub to: String,
    pub services: Vec<String>,
    pub action: Action,
    #[serde(default = "enabled_by_default")]
    pub enabled: bool,
}

fn enabled_by_default() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
pub struct Zone {
    pub id: String,
    pub kind: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Node {
    pub id: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Endpoint {
    pub node: Node,
    pub zone: Zone,
}

/// The TypeScript `Decision` carries the whole rule; across the WASM boundary only its id travels.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Decision {
    pub allowed: bool,
    pub rule: Option<String>,
    pub reason: String,
}

const OUTSIDE_SOURCES: [&str; 2] = ["internet", "cloud"];
const PUBLIC_DESTINATIONS: [&str; 3] = ["internet", "cloud", "edge"];

/// Splits `type:ref`. Mirrors the TS `indexOf`/`slice` exactly, including a selector with no
/// colon (`slice(0, -1)` drops the last character), so both engines agree on malformed input.
pub(crate) fn split_selector(selector: &str) -> (&str, &str) {
    match selector.find(':') {
        Some(i) => (&selector[..i], &selector[i + 1..]),
        None => {
            let cut = selector.char_indices().last().map_or(0, |(i, _)| i);
            (&selector[..cut], selector)
        }
    }
}

pub fn matches(selector: &str, e: &Endpoint) -> bool {
    if selector == "any" {
        return true;
    }
    let (kind, reference) = split_selector(selector);
    match kind {
        "kind" => e.zone.kind == reference,
        "zone" => e.zone.id == reference,
        "node" => e.node.id == reference,
        "tag" => e.node.tags.iter().any(|t| t == reference),
        _ => false,
    }
}

pub fn decide(rules: &[Rule], from: &Endpoint, to: &Endpoint, service: &str) -> Decision {
    if from.zone.id == to.zone.id {
        return Decision {
            allowed: true,
            rule: None,
            reason: "Same zone: not filtered by the firewall".into(),
        };
    }
    for r in rules {
        if !r.enabled {
            continue;
        }
        if !r.services.iter().any(|s| s == "any" || s == service) {
            continue;
        }
        if !matches(&r.from, from) || !matches(&r.to, to) {
            continue;
        }
        let allowed = r.action == Action::Allow;
        let verb = if allowed { "Allowed" } else { "Blocked" };
        return Decision {
            allowed,
            rule: Some(r.id.clone()),
            reason: format!("{verb} by rule \u{201c}{}\u{201d}", r.name),
        };
    }
    if OUTSIDE_SOURCES.contains(&from.zone.kind.as_str())
        && !PUBLIC_DESTINATIONS.contains(&to.zone.kind.as_str())
    {
        return Decision {
            allowed: false,
            rule: None,
            reason: "Default policy: inbound from the internet is denied".into(),
        };
    }
    Decision {
        allowed: true,
        rule: None,
        reason: "Default policy: allowed (no rule matched)".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    fn office() -> Endpoint {
        ep("pc", &["byod"], "z-office", "office")
    }
    fn servers() -> Endpoint {
        ep("db", &[], "z-server", "server")
    }
    fn internet() -> Endpoint {
        ep("inet", &[], "z-internet", "internet")
    }

    #[test]
    fn never_filters_inside_a_zone() {
        let rules = [rule("r", "any", "any", &["any"], Action::Deny, true)];
        let d = decide(
            &rules,
            &office(),
            &ep("pc2", &[], "z-office", "office"),
            "files",
        );
        assert!(d.allowed);
        assert_eq!(d.rule, None);
    }

    #[test]
    fn first_matching_enabled_rule_wins_respecting_services() {
        let rules = [
            rule("off", "any", "any", &["any"], Action::Deny, false),
            rule(
                "only-sql",
                "kind:office",
                "kind:server",
                &["practice-db"],
                Action::Deny,
                true,
            ),
            rule(
                "allow",
                "kind:office",
                "kind:server",
                &["any"],
                Action::Allow,
                true,
            ),
            rule("late-deny", "any", "any", &["any"], Action::Deny, true),
        ];
        let sql = decide(&rules, &office(), &servers(), "practice-db");
        assert_eq!(
            (sql.allowed, sql.rule.as_deref()),
            (false, Some("only-sql"))
        );
        assert_eq!(sql.reason, "Blocked by rule \u{201c}only-sql\u{201d}");
        let files = decide(&rules, &office(), &servers(), "files");
        assert_eq!(
            (files.allowed, files.rule.as_deref()),
            (true, Some("allow"))
        );
    }

    #[test]
    fn selectors_match_zone_node_and_tag() {
        let e = office();
        assert!(matches("any", &e));
        assert!(matches("kind:office", &e));
        assert!(matches("zone:z-office", &e));
        assert!(matches("node:pc", &e));
        assert!(matches("tag:byod", &e));
        assert!(!matches("tag:guest", &e));
        assert!(!matches("bogus:office", &e));
        // Malformed selector (no colon) behaves exactly like the TypeScript slice() arithmetic.
        assert!(!matches("office", &e));
    }

    #[test]
    fn default_policy_denies_inbound_from_outside_only_into_private_zones() {
        let d = decide(&[], &internet(), &servers(), "web");
        assert!(!d.allowed);
        assert_eq!(
            d.reason,
            "Default policy: inbound from the internet is denied"
        );
        let edge = ep("portal", &[], "z-edge", "edge");
        assert!(decide(&[], &internet(), &edge, "web").allowed);
        assert!(decide(&[], &office(), &internet(), "web").allowed);
    }

    #[test]
    fn rules_parse_from_engine_json_with_defaults() {
        let json = r#"{"id":"r1","name":"Block guests","from":"kind:guest","to":"any","services":["any"],"action":"deny","extra":1}"#;
        let r: Rule = serde_json::from_str(json).unwrap();
        assert!(r.enabled);
        assert_eq!(r.action, Action::Deny);
    }
}
