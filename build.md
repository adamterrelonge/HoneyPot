# Honeypot — Build Reference

> **This is the source of truth for the project.** Read it before every phase. If a decision
> changes, update this file in the same change and record why in `BUILD_DIARY.md`.
> Do not let the code and this file disagree.

---

## 1. Vision

A browser-based **business network simulator**. A user creates a business (SME → enterprise),
the app generates a realistic network, and draws it on a clean isometric grid. The user then
lives through realistic situations (outages, attacks, misconfigurations, failed updates,
capacity problems) and responds by inspecting nodes, changing permissions, editing firewall
rules, disabling access, and installing firmware.

**Who it's for:** people learning how business networks behave and fail, such as IT generalists,
students, SME owners and security trainees. Priorities are **clarity over completeness** and
**cause and effect over packet-level accuracy**.

**Safety rule:** this is a closed simulation. It never touches real hosts, never scans and never
sends network traffic beyond loading its own assets.

---

## 2. Non-negotiable principles

1. **The engine is pure TypeScript.** `src/engine/**` must not import React, Pixi, Zustand or the
   DOM. This is enforced by `tsconfig.engine.json` (no `DOM` lib). From Phase 2 the engine runs
   in a Web Worker.
2. **Simulation state never lives in React state.** React holds UI state only (selection, panels,
   tool mode). The worker pushes read-only snapshots into `useSim` (`src/state/sim.ts`); the
   renderer subscribes outside React and components read them through narrow selectors.
3. **Every mutation is a Command** (from Phase 2), e.g. `{ type: "link.setStatus", linkId, status, t }`.
   The command log enables undo, replay, after-action reports and shareable scenarios.
4. **Determinism.** All randomness goes through a seeded RNG. The same seed plus the same
   commands always gives the same outcome. Tests depend on this.
5. **Simulate flows, not packets.** Traffic is aggregate demand per service pair (Mbps, latency,
   loss). Particles drawn on links are decorative samples of flows.
6. **Explainability is a feature.** Every failure must be traceable to a cause the user can see:
   the trace tool, event log and inspector reasons.
7. **Abstract with intent.** Each abstraction is listed in §7 so realism decisions are made once.
8. **Every phase ends green**: typecheck, unit tests, production build, a visual check, then a
   diary entry.

---

## 3. Stack

| Concern | Choice | Notes |
|---|---|---|
| Build / dev | **Vite 8** | SPA, no SSR. |
| UI | **React 19 + TypeScript 7** | `strict: true`. |
| Rendering | **PixiJS 8** (WebGL) | Imperative scene class wrapped by one React component. |
| UI state | **Zustand 5** | The renderer subscribes outside React via `store.subscribe`. |
| Graph | **graphology** | Topology graph and algorithms. |
| Schemas | **Zod 4** | Topologies, scenarios and commands are validated at the boundary. |
| Styling | **Tailwind CSS 4** + CSS custom properties | Tokens in `src/styles.css`. |
| Font | System stack → **Inter Variable** fallback | SF Pro can't be redistributed, so Apple devices get it natively. |
| Tests | **Vitest** (engine and math), Chrome DevTools/Playwright for visual checks, Lighthouse | |
| CI | **GitHub Actions** (`.github/workflows/ci.yml`) | Phase 10 |
| Engine hot paths | **Rust → WebAssembly** (`engine-rs/`), draft | Phase 10; TS engine stays the reference |
| Backend (optional) | **FastAPI** + SQLAlchemy (`api/`), draft | Phase 10 |
| Worker RPC | **Comlink 4** | `src/worker/sim.worker.ts` exposes `SimHost`. |
| Persistence | IndexedDB via a ~70-line wrapper (Phase 7; Dexie wasn't needed for one object store) | |

### Device artwork
Device images in `public/emoji/` may be **any aspect ratio** (the project now uses custom images alongside Fluent
3D emoji). They are never stretched:
- On the canvas, sprites are scaled uniformly so their longest side equals the kind's size (`fitSprite` in
  `scene.ts`), anchored at the bottom centre.
- In the DOM, a global `img { object-fit: contain }` keeps every icon's proportions inside its box.

### Emoji assets
Nodes are drawn as **3D emoji**. Apple's emoji artwork is proprietary and can't be shipped, and
native emoji fonts look different on every OS. We therefore use **Microsoft Fluent Emoji 3D**
(MIT, licence in `public/emoji/LICENSE-fluentui-emoji.txt`). These are glossy 3D renders at
256×256 that match the intended look on every platform. They are stored locally in
`public/emoji/` and mapped from node kinds in `src/engine/catalog.ts`.

---

## 4. Design language — "Apple-clean"

- **White and air.** The canvas is `#FBFBFD`, the page `#F5F5F7`. Use lots of negative space.
- **Hairlines.** Grid and borders are 1 device pixel at low alpha (`rgba(0,0,0,.06–.10)`).
  Lines stay 1px at every zoom level (`pixelLine`).
- **Glass panels.** `rgba(255,255,255,.72)`, `backdrop-filter: blur(20px) saturate(180%)`,
  a 0.5px border and a soft shadow `0 8px 32px rgba(0,0,0,.08)`. Radius 14px for controls, 20px
  for panels.
- **Typography.** `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter Variable", system-ui`.
  Text sizes 11/13/15/20/28. Weights 400/500/600. Small text gets slight negative tracking.
- **Colour is meaning, not decoration.** Neutral greys everywhere, with Apple system colours only
  for state:

**Tokens (Phase 8).** `src/styles.css` is the source of truth, and `src/ui/contrast.test.ts` checks
every pair for WCAG 2.2 AA in both themes. Components use semantic tokens only; that test fails on
raw `white`/`black` or hex colours.

| Token | Light | Dark | Use |
|---|---|---|---|
| `ink / ink-2 / ink-3` | `#1D1D1F / #515154 / #68686D` | `#F5F5F7 / #C7C7CC / #A1A1A6` | text hierarchy (all ≥ 4.5:1) |
| `surface / surface-2` | `#FFFFFF / #F0F0F3` | `#1C1C1E / #2C2C2E` | panels, controls |
| `canvas / page` | `#FBFBFD / #F5F5F7` | `#161618 / #0E0E10` | background |
| `fill` (with /opacity) | black | white | hover, wells, chips |
| `accent` | `#0071E3` | `#0071E3` | primary fills (white text 4.7:1); hover `#0062C4` |
| `accent-ink` | `#0059B3` | `#4DA3FF` | links and accent text |
| `ok` / `ok-ink` | `#248A3D` / `#1D6B31` | `#30D158` / `#30D158` | healthy dot / text |
| `warn` / `warn-ink` | `#B86E00` / `#8A3B00` | `#FF9F0A` / `#FFB340` | degraded dot / text |
| `bad` / `bad-ink` | `#D70015` / `#A8000F` | `#D70015` / `#FF6961` | failed fill / text |
| `pwned` / `pwned-ink` | `#8944AB` / `#7A3A99` | `#BF5AF2` / `#DA8FFF` | compromised |
| `caution` / `caution-ink` | `#FFCC00` / `#6B5100` | `#FFD60A` / `#FFD60A` | medium severity |

The light status dots are darker than Apple's system colours (e.g. ok `#248A3D`, not `#34C759`) so
they reach 3:1 against white, as WCAG 1.4.11 requires for meaningful graphics. The canvas has its
own light and dark `Palette` in `render/theme.ts`; dark zone plates are each zone's hue mixed 13%
into `#1C1C1E`.

- **Theme:** follows the system by default. The top-bar toggle cycles System → Light → Dark and is
  remembered per browser. `<html data-theme>` forces a choice; no attribute means "follow the system".
- **Focus:** every control shows a 2px accent outline on keyboard focus (`:focus-visible`).

- **Zones** are soft-tinted floor plates (`internet` blue, `edge` peach, `server` lavender,
  `office` mint, `branch` sand, `cloud` sky) with a hairline outline and a small caps label.
- **Links** are 1px hairline cables lying on the floor. They follow the two isometric axes with
  rounded corners, run in parallel lanes 7px apart, and leave a small gap where one cable crosses
  another (see §5 "Link routing"). Selection turns them accent blue. Downed links are dashed red,
  blocked links (isolated endpoint) faint dashed grey, and busy links turn orange (≥80%) or red (≥100%).
- **Trace** highlights the traced path with a bold 3px line:
  - Green: the whole path works.
  - Broken at a link or device: blue up to the break, red at the break, grey after it.
  - Blocked by policy: red throughout.
  Everything off the path dims, including traffic particles.
- **Groups** (one node standing for many identical devices) draw as a stacked icon with a dark count
  pill. Zoomed in (≥105%) the stack fans out into a small crowd. Zoomed out (<55%) device labels fade
  and each zone shows a screen-aligned tag with its name and device count, but only when the zone is
  wide enough on screen to hold it.
- **Traffic** is shown as small dots moving along cables in the bulk direction: blue for staff apps,
  indigo for external users, green for voice, teal for system traffic (backup, CCTV) and orange when degraded.
- **Motion.** Ease-out curves of 150–250ms. Nodes lift slightly on hover. No bouncy springs.
  With the OS "reduce motion" setting, the camera jumps instead of gliding, nothing pulses or lifts,
  CSS transitions are off and traffic dots are hidden. Load still shows through cable colour and
  width, the services panel and the table view.

---

## 5. Architecture

```
┌──────────────── Main thread ────────────────┐      ┌────── Worker (Phase 2+) ──────┐
│ React UI  (TopBar, Sidebar, Inspector, …)   │      │ Engine (pure TS)              │
│   │ intents ▼          ▲ UI state           │ cmd  │  World  (graphology)          │
│ Zustand store (selection, panels, mode)     │─────►│  Clock  (fixed tick, speed)   │
│   │ subscribe                               │◄─────│  Flows / Reachability / Policy│
│ Pixi Scene (grid, zones, links, nodes, fx)  │ snap │  Incidents / Scenario runner  │
└─────────────────────────────────────────────┘      │  Seeded RNG, Command log      │
                                                     └───────────────────────────────┘
```

### Directory layout
```
src/
  engine/        pure TS: model (schema), catalog, graph, stress (synthetic topology)
    sim/         rng, clock, commands, demands, simulation, types
    gen/         spec (BusinessSpec + wizard metadata), generate (templates → TopologyInput)
    policy/      policy.ts: rule matching, decisions, roles (pure)
    firmware/    catalog.ts (products, releases, real CVE advisories), lifecycle.ts (installs, failures)
    incidents/   catalog.ts (10 incident kinds, actions, costs, scenarios), engine.ts (kill chains, detection, scoring),
                 report.ts (after-action report as Markdown)
    save/        save.ts (save format, business refs, restore + hash check)
  worker/        sim.worker.ts: owns the Simulation, drives the clock, pushes snapshots (Comlink);
                 wire.ts: compact snapshot transport (static parts once, numbers as typed arrays)
  render/        geometry.ts + routing.ts (pure math, tested), theme.ts, scene.ts (Pixi), NetworkCanvas.tsx
  state/         store.ts (UI state + static layout), sim.ts (snapshot mirror + command facade, autosaves)
  persist/       db.ts (IndexedDB save slots), share.ts (share codes)
  ui/            React components (glass panels): panels.tsx, sim-panels.tsx, wizard.tsx, policy-panels.tsx,
                 lifecycle-panels.tsx, game-panels.tsx (Play sheet, HUD, incidents, after-action report),
                 save-panels.tsx (undo/redo, Saves sheet, notices), tour.tsx (guided tour),
                 a11y-panels.tsx (theme toggle, table view, skip links, live announcer), a11y.ts (dialog focus)
  state/prefs.ts per-browser preferences: theme, reduced motion, "Don't ask again"
  state/viewport.ts screen size classes (compact < 1280 px, narrow < 900 px) for the tablet layout
  data/          topology & scenario JSON
public/emoji/    Fluent 3D emoji PNGs (MIT)
```

Dev URL flag: `?stress=200` loads the synthetic 200-node topology. In dev,
`window.__honeypotScene.stats()` reports node, link, stream and particle counts.

### Isometric maths
- Tile size: `TILE_W = 96`, `TILE_H = 48` (2:1 dimetric).
- `project(x, y) = { sx: (x − y)·W/2, sy: (x + y)·H/2 }`. `unproject` is the exact inverse.
- Draw order: `zIndex = (x + y)·1000 + x` for nodes. Links are drawn under nodes.
- Grid +x runs to the lower right on screen, +y to the lower left. Traffic generally flows
  "top" (Internet, small x+y) to "bottom" (office, large x+y).

### Link routing (`render/routing.ts`)
Cables lie on the floor and follow the grid axes. The router is pure and deterministic and runs once per topology.
1. **Route:** A* over tiles (4-neighbour). Costs: step 1, turn +2, a segment already used by another
   cable +0.4 per cable, a tile next to a device +0.3. Other devices' tiles are obstacles. Longest
   links are routed first.
2. **Lanes:** each straight run ("leg") on the same grid line that overlaps or touches another leg
   forms a bundle. Every leg gets its own lane, `LANE_PX = 7` apart and centred on the line. The order
   is chosen so the cable that turns off first sits on the side it turns towards. Ties are broken from
   the neighbouring legs' lanes so bundles keep their order through corners. Cables therefore plug into
   a device side by side, `PORT_INSET = 0.32` tiles from its centre, never into one shared point.
3. **Corners:** quarter circles on the floor (ellipses on screen), `CORNER_RADIUS = 0.34` tiles,
   adjusted per lane so bundles turn concentrically.
4. **Crossings:** where perpendicular legs of different cables cross, the lower-priority cable
   (wan > fibre > copper > vpn > wifi, then routing order) gets a ±4.5px gap.

Particles sample the same polylines (`pointAlong`). A flow's particle path is its links' routes
chained in path order, reversed for downloads.

---

## 6. Domain model (grows by phase)

```ts
NodeKind = internet | isp | router | firewall | switch | wifi | server | database | nas
         | desktop | laptop | phone | printer | cloud | camera | voip | pos | vpn | honeypot | user
         | plc | medical                                                    (Phase 3)
ZoneKind = internet | edge | server | office | branch | cloud | guest | factory | clinical | secure
NetNode  { id, kind, label, zoneId, pos{x,y}, ip?, subnet?, vlan?, os?, firmware?{vendor,version},
           status: online|offline|degraded|compromised, services[], tags[], count = 1 }
Link     { id, a, b, medium: fiber|copper|wifi|wan|vpn, bandwidthMbps, latencyMs, status: up|down,
           dependsOn: linkId[] = [] }            // overlay (VPN tunnel) riding on these links, a → b
Zone     { id, name, kind, origin{x,y}, size{w,h}, site = "hq" }
Topology { meta{ name, industry, size, employees, seed,
                 profile?{ industry, budget, hosting, compliance[], sites } }, zones[], nodes[], links[] }
```
Topology invariants (enforced by `TopologySchema`): unique ids; links reference existing nodes;
no self-links or duplicate links; each node lies inside its zone; at most one node per tile;
an overlay's `dependsOn` is an existing chain of physical links walking from `a` to `b`.

**Groups:** a node with `count > 1` stands for that many identical devices. Demand scales with
`count`, health counts users (not flows), and jitter and bursts shrink by `1/√count` because big
groups average out. The generator groups a set of identical computers, cameras or controllers only
when a zone has **more than 12** of them; handsets, mobiles, guest devices and AP sets are always one
node.

**Phase 2 additions** (`engine/sim/types.ts`):
```ts
Command  = link.setStatus{linkId,status} | node.setPower{nodeId,on} | node.setIsolated{nodeId,isolated}
Demand   { id, app, client, server, via?, bulk: toClient|toServer|both, baseMbps, schedule, needs[dns|directory],
           latencyBudgetMs, lossBudget }            // derived from node kinds + hosted services
FlowState{ …Demand, status: idle|ok|degraded|down, reason?, demandMbps, throughputMbps, latencyMs, loss, path }
NodeSim  { status, powered, isolated, reasons[] }   LinkSim { state: up|down|blocked, util, loadAB, loadBA }
AppHealth{ app, status, total, ok, degraded, down, reason? }   SimEvent { seq, tick, minute, severity, text, subject? }
Snapshot { seed, tick, minute, nodes, links, flows, apps, events, hash }
```
- **Time:** 1 tick = 15 simulated seconds. 1× = 4 ticks/s (1 real second = 1 simulated minute). 4× and 16×
  run more ticks per second, never bigger ticks. Start time is Monday 08:40. The working day ramps up
  07:30–08:45, dips at lunch 12:00–13:30 and ramps down 17:15–18:30; weekends run at ~3%.
- **Demand per client at full activity:** desktop/laptop email & docs 1.2, files 1.0, practice DB 0.5,
  web 0.8, print 0.15 (desktops only) ≈ 3.5 Mbps; phones 1.0. Portal 15 Mbps from the internet; VPN remote
  users 4 Mbps via the gateway; voice 0.6 Mbps (6 calls) with a 150 ms / 1% loss budget; CCTV 4 Mbps to the
  NAS 24/7; backups servers → NAS 22:00–01:00, then NAS → cloud 01:00–05:00 at 300 Mbps.
- **Dependencies:** business apps need DNS, then sign-in (directory), to be reachable. Web and print need DNS only.
- Internet and cloud nodes are outside the business and can't be powered off or isolated; disable their links instead.

**Phase 3 additions** (`engine/gen/spec.ts`):
```ts
BusinessSpec { name, industry: professional|retail|healthcare|manufacturing, size: sme|mid|enterprise,
               employees, sites, hosting: cloud-first|on-prem, budget: lean|standard|generous,
               compliance: (gdpr|pci-dss|health-data|iso27001|cyber-essentials)[], seed }
```
| Size | Staff | Sites |
|---|---|---|
| SME | 10–50 | 1–2 |
| Mid | 50–250 | 2–3 |
| Enterprise | 250–2,000 | 5–8 |

What each choice changes in `generateBusiness`:
- **Industry:** departments and device mix; line-of-business system name; portal; specials.
  - Retail: stores as branches, card terminals, shopper Wi-Fi, a "Card Payments" provider.
  - Healthcare: a clinical zone with an imaging archive and imaging devices, a waiting-room Wi-Fi zone.
  - Manufacturing: a factory zone with SCADA and PLC lines.
- **Sites:** HQ takes 60% of staff (retail 20%). Each branch has its own broadband and a VPN tunnel to
  the HQ VPN gateway that rides branch-broadband → internet → ISP → firewall → gateway. Branch routers
  forward DNS locally.
- **Hosting:** cloud-first replaces the DC, file and DB servers with Cloud Identity, Cloud Workspace
  (files) and a cloud business system, and the firewall serves DNS. On-prem keeps them in the server room.
- **Budget:**
  - Headroom ×1.25 / ×1.7 / ×2.5 on every link, rounded up to a real tier (20 Mbps … 100 Gbps).
  - End-of-life OS rate 25% / 10% / 3%; default-credential cameras 60% / 30% / 10%.
  - Lean: copper 1 G core and no offsite backup. Generous: backup ISP and a private WAN link per branch.
- **Compliance:**
  - PCI DSS: card terminals go in their own "Payments (PCI)" zone on VLAN 70 (otherwise tagged `flat-network`).
  - Health data: clinical VLAN 100.
  - ISO 27001: OT VLAN 80.
  - ISO 27001 or Cyber Essentials: EOL rate ×0.3 and no default credentials.
  - Policy enforcement itself is Phase 4.
- **Layout:** columns Internet | Edge | HQ zones | branch zones, each wrapping at 34 tiles. Devices sit on
  alternate tiles inside a zone, so cables always have corridors.

**Phase 4 additions** (`model.ts`, `engine/policy`):
```ts
Topology.policy   { rules: Rule[] }      // ordered, first match wins
Rule              { id, name, from: Selector, to: Selector, services: (AppId|"dns"|"directory"|"any")[],
                    action: allow|deny, enabled }
Selector          = "any" | "kind:<zone kind>" | "zone:<zone id>" | "node:<device id>" | "tag:<device tag>"
Topology.identity { roles: Partial<Record<Role, { mfa, access: Record<app, none|read|write> }>> }
Role              = staff | manager | privileged | it-admin      NetNode.role? (default: privileged tag → privileged, else staff)
Commands          policy.addRule{rule,index?} | policy.updateRule{ruleId,patch} | policy.moveRule{ruleId,index}
                  | policy.removeRule{ruleId} | node.setAccess{nodeId,blocked} | node.setRole{nodeId,role}
                  | identity.setAccess{role,app,access} | identity.setMfa{role,enabled}
Snapshot.policy   { rules, blocking: Record<ruleId, users> }   Snapshot.identity { roles, nodeRoles }
TraceResult       { from, to, service, ok, verdict, steps: TraceStep[], path, failed? }
```
**Evaluation**, once per flow leg, from the source device's zone to the destination's:
- Same zone: not filtered.
- Otherwise the first enabled rule matching from, to and service decides.
- With no match, the default policy applies: internet/cloud → private zone is denied, everything else is allowed.
- DNS and sign-in lookups are filtered too (service `dns`/`directory`). Each lookup uses the first reachable
  host that the firewall permits.

**Identity:** apps that need sign-in (email & docs, files, business system, remote) are denied when the user's
role has `none` access. MFA is recorded per role now and will be used by attack scenarios (Phase 6).

**Disable access** adds the rule `block-<id>` (deny device → anywhere, any service) at #1. Restore removes it.
All actions apply to whole groups.

**Generator default policy:**
- Guest devices (`tag:guest`): DNS, then web to the internet, then deny everything else.
- PCI DSS: the secure zone may use DNS, then reach the payment provider, then deny out; deny everything in.
- Health data: allow branch imaging → archive; deny office/branch → clinical.
- ISO 27001: deny office/branch → factory.
- No compliance: no rules (a flat network).

**Roles:**
- Finance devices are managers; partners and clinicians are privileged; one IT admin laptop per HQ (three for
  enterprise) is it-admin.
- Business-system access: staff read, others write.
- MFA: lean = IT admins; standard = IT admins + privileged; generous = everyone.

**Trace** (`Simulation.trace(from, to, service?)`; the service is inferred from the destination when omitted).
Steps run in order:
1. Both devices usable.
2. DNS and sign-in (via whichever host, and whether the firewall allows it).
3. Role permission.
4. Firewall decision between the zones.
5. Each hop with medium, latency and utilisation, or the would-be path with the first broken link or device.
After the first ✗, later steps show as not reached.

**Phase 5 additions** (`engine/firmware`):
```ts
Product   { id, vendor, name, kinds[], providerManaged?, releases: Release[], advisories: Advisory[] }
Release   { version, date: YYYY-MM, stability 0–1, notes }
Advisory  { cve (real), title, severity, cvss, exploited (CISA KEV), realWorld (the real product), fixedIn, since?, needsService? }
DeviceSim { product, version, latest, previous, providerManaged, ageYears, condition: ok|updating|config-broken|bricked|failed,
            fault, untilMinute, job{to,endsMinute,rollback}, scheduled{version,atMinute}, advisories: CVE[] }
Commands  firmware.install{nodeId,version,when:now|tonight} | firmware.cancel | firmware.rollback
          | hardware.setFailures{enabled} | device.fail{nodeId,fault?,hours?}
```
**Real CVEs:** vendors are fictional, but each product line is modelled on a real one and its advisories carry
the real CVE id, CVSS v3 score, exploited flag and the real product it affects (`realWorld`). For example,
Kestrel KestrelOS is modelled on Fortinet FortiOS and carries CVE-2023-27997. The UI says so and links to NVD.
Fixed-in versions are this simulation's own release numbers. CVE details were written from memory: verify
against NVD when changing the catalogue.

**Lines:**
- Firewall and VPN: Fortinet- and Pulse/Ivanti-modelled.
- Switch (Cisco Smart Install); ISP router (Arcadyan, provider-managed: you can't update it); branch router
  (Realtek SDK).
- AP (KRACK); NAS (QNAP HBS3); camera (Hikvision); printer (HP); PLC (Rockwell); imaging device (EternalBlue).
- Windows Server (Zerologon on DCs only, PrintNightmare); Windows client (PrintNightmare); portal app (Log4Shell).

Device → line is matched by firmware prefix, then by OS. Initial versions follow the budget: lean = oldest,
standard = one or two behind, generous = latest. The generator ships firmware this way too.

**Install outcomes (accepted defaults):**
- Downtime 5–20 min (rollback 5–10).
- Config migration failure 2–8% (scaled by release stability). The device then degrades every flow through it:
  throughput ×0.5, +60 ms, with a "roll back" reason.
- Brick 0.5–2% on lean (×0.5 standard, ×0.25 generous). The device is dead for 4 h, then replaced on the
  previous version.
- Rollback is always possible unless bricked.
- Outcomes are seeded per device and tick. Group updates apply to the whole group.

**Maintenance window:** "Tonight" schedules for the next 22:00. Cancel is allowed until it starts.

**Hardware ageing and random failures (on by default, can be switched off):**
- Age by budget: lean 3–9 years, standard 1–6, generous 0–4.
- Per-tick hazard = annual failure rate (by kind, 1–6%) × (1 + 0.35 × years over 4) × budget factor (lean 1.5,
  standard 1, generous 0.7) × 52 (compression: roughly one failure a simulated week for a small business)
  ÷ ticks per year.
- Only single devices fail, not groups. Repairs take 2–6 h.

**Phase 6 additions** (`engine/incidents`):
- **Modes:**
  - `sandbox` (default): no incidents and no scoring.
  - `free`: seeded random incidents. Calm, normal and intense run at 0.1, 0.2 and 0.5 per hour, with a
    quarter of that rate overnight. At most 2 run at once, weighted towards whatever is exposed.
  - `scenario`: scripted events, a duration and objectives. Five are built in; `ScenarioSchema` validates
    scenario JSON.
- **Commands:**
  - `game.start{mode, scenarioId?, intensity?}` and `game.stop`.
  - `incident.start{kind, target?}` and `incident.act{incidentId, action, nodeId?}`.
  - `decoy.setDeployed{nodeId, deployed}`.
  - The snapshot gains `game: GameView`.
- **Ten incident kinds:** ransomware, phishing, edge exploit, DDoS, ISP outage, DNS misconfiguration, expired
  certificate, backup saturating the WAN, failed update, insider. Hardware failure, listed in the original
  plan, is covered by Phase 5's random failures, so an edge (VPN/firewall) exploit took its slot.
- **Kill chain** (ransomware, phishing, edge exploit):
  - **Initial access:** a camera on its default password, a phished person device whose role lacks MFA, or an
    internet-facing device with an exploited CVE. If none exists, the attack is "blocked" (logged as good news).
  - **Lateral movement:** every 10 sim-min the attacker tries a target reachable via route and firewall
    (`files`). Success is 90% with an exploited CVE, otherwise 45% (stolen credentials). Servers weigh 3,
    decoys 4.
  - **Impact:** after 3–5 moves. Ransomware encrypts its footholds, which stay unusable until restored. The
    other attacks exfiltrate: 30 Mbps of red `exfil` flows, counted as stolen data.
  - **Contained** when no foothold is usable (isolate, power off, disable access). **Resolved** when contained
    and restored.
  - "Reset credentials" evicts footholds not held by an exploited CVE.
- **Restore:** NAS backup 2 h £1k, offsite 4 h £2k, rebuild 24 h £10k, desktop re-image 1 h £500.
- **Faults:**
  - ISP outage: the primary WAN is down 1–3 h; escalating makes it 40% faster.
  - DDoS: 2.5× WAN capacity at the portal for 2 h; upstream scrubbing takes 15 min and costs £1.5k.
  - DNS misconfiguration: the internal DNS host gives wrong answers; revert takes 10 min.
  - Expired certificate: the portal is down; renewal takes 20 min and costs £150.
  - Daytime backup: 300 Mbps from the NAS to the cloud for 6 h; can be paused.
  - Failed update: forces a config-broken firmware update; roll back to fix.
  - Insider: a privileged or manager device sends 20 Mbps of exfil; disable access or isolate.
- **Detection:** incidents are hidden from the player until detected:
  - by time (phishing 3 h, edge exploit 6 h, insider 4 h, faults within minutes);
  - immediately on encryption, a decoy being touched, or more than 2 GB exfiltrated;
  - insiders within 30 min if a deployed decoy is reachable from their device.
  Undetected incidents still appear in the report.
- **Decoys:** dormant `honeypot` nodes tagged `decoy` (server room and first office floor). Until deployed they
  are hidden and unusable. Deploying one costs £400 while playing.
- **Costs:**
  - £ per affected user per minute, by app: work apps £0.03–0.24 (a weighted share of an idle employee),
    payments £1.50, production £3, imaging £0.60, portal £0.10. Degraded service counts half.
  - Firmware installs cost £150 now or £250 tonight, plus the action costs above.
  - Budget = £400 / £1,200 / £3,000 per employee (lean / standard / generous).
- **Score** = 1000 − 450·lost/budget − 250·spend/budget − 0.08·MB stolen − 1.5·average minutes to contain.
  Each objective passed or failed adds or subtracts 50. Grades: A ≥ 850, B ≥ 700, C ≥ 550, D ≥ 400, F below.
- **After-action report:** every incident, including undetected ones, with its timeline, cost and lessons,
  plus objectives and the grade.

**Phase 7 additions** (`engine/save`, `persist/`):
- **Undo/redo** lives in the Simulation:
  - Before each command it computes the inverse from the current state: previous power, rule, role,
    access, MFA, decoy, failures switch, tonight's scheduled install.
  - Undo applies that inverse *at the current tick*, logged like any command. The clock never goes back, and
    replays stay exact.
  - Not undoable: installs already running, rollbacks, device failures, incidents, games. They don't block
    undoing earlier changes.
  - A new change clears redo. The history holds 100 entries.
  - **Games are final:** `game.start` clears history, and undo/redo are refused while a game runs.
  - The snapshot gains `history: {undo, redo, locked}` (button labels).
- **Saves restore state; they don't replay.** Replaying costs ≈ 1 s per simulated day for the sample,
  2 s for a mid-size business and 10 s for an enterprise (measured).
  - `Simulation.exportState()` / `importState()` hold every changing value, including the noise smoothing
    arrays, the command log, events, and the lifecycle and incident engines.
  - All randomness is `noise(seed, tick)`, so there's no RNG stream to capture.
  - The save format is `SaveFile {format: "honeypot-save", v: 1, business, seed, hash, state}`.
  - The business is stored as its wizard spec when regenerating reproduces the topology exactly; otherwise
    (the sample, hand-made topologies) as the full topology.
  - Loading recomputes the snapshot hash and rejects any mismatch: tampering, a business that no longer
    matches, or engine changes since the save.
- **Loading** happens in two steps in the worker: `prepareSave` verifies, the UI swaps the map, then
  `activateSave` switches sessions. No snapshot can arrive for a map that isn't shown yet.
- **Storage:** IndexedDB database `honeypot`, store `saves`. Records are
  `{id, kind: auto|named, name, createdAt, summary, save}`.
  - Autosaves: the worker stops a batch of ticks exactly at midnight and hands over a save. The newest 7
    are kept, and a notice reads "Autosaved · <business> · Tue 00:00".
- **Share codes:** `HONEYPOT1-` + base64url(deflate-raw(JSON)). Pasted whitespace is ignored, and bad codes
  get a readable error.
  - Sizes: about 5k characters for the sample, about 21k for an enterprise (it travels as its spec).
- **Report export:** `reportMarkdown(game, info)` produces a summary table, objectives, and every
  incident (including undetected ones) with times, cost, footholds, timeline and lessons.
  - Downloaded as `<business>-after-action-report-<date>.md`.

**Planned additions:** Phase 8 none for the data model (polish and accessibility).

---

## 7. Abstraction ledger (what we simulate and what we don't)

| Area | Simulated | Abstracted away |
|---|---|---|
| Traffic | flows per service pair: demand Mbps, utilisation, latency, loss. Bulk/ack split 85/15 per direction; full-duplex links; oversubscribed links scale flows proportionally (no max-min fairness); queueing delay 2u/(1−u) ms capped at 150, 150–250 ms when full; "loss" = undelivered share | packets, TCP behaviour, MTU, Wi-Fi airtime sharing |
| Routing | shortest path (latency + 0.05 per hop); only forwarding kinds (internet, isp, router, firewall, switch, wifi) carry transit; paths recomputed only after a command | routing protocols, ECMP, asymmetric routes |
| Dependencies | DNS → sign-in → app, checked as reachability to **any** host offering the service | caching, DHCP leases, Kerberos tickets |
| Edge / NAT | stateful-edge rule: once a path has crossed the internet it may not enter a private zone (anything but internet/edge/cloud). Inbound only via a VPN gateway (`via`) or a tunnel | NAT tables, port forwarding |
| Firewall | one logical policy evaluated end-to-end per flow leg (source zone → destination zone), first match wins, intra-zone unfiltered, stateless "allow means both directions" | per-interface rule sets, stateful connection tracking, ports/protocols (services stand in for them) |
| Identity | roles with per-app none/read/write and an MFA flag; a group shares one role | individual accounts, groups-in-groups, conditional access |
| WAN | site-to-site VPN = overlay link whose traffic also loads (and whose health depends on) its underlay chain; private WAN = plain link | tunnel failover across ISPs, IPsec overheads, MTU |
| Groups | one node = N identical devices: demand × N, users counted N, jitter/bursts ÷ √N; Wi-Fi APs grouped and sized at ~30 clients each | per-device state inside a group (Phase 4+ may split groups) |
| L2 | VLAN membership, trunk vs access, switch failure | STP, MAC tables, ARP |
| L3 | subnets, default gateways, static routing between zones, NAT at edge | dynamic routing protocols (BGP/OSPF) except as "ISP up/down" |
| Policy | ordered firewall rules (src zone/subnet, dst, service, allow/deny), ACLs | stateful inspection internals |
| Identity | users, groups, role permissions on services, MFA on/off, privileged accounts | Kerberos/LDAP internals |
| Devices | status, CPU/mem load as %, firmware version, config flags, lifespan | real OS behaviour |
| Firmware | catalogue with real CVE references, stability, update downtime, config-migration and brick risk, rollback, provider-managed kit, a 22:00 maintenance window | binary images, staged rollouts, vendor support contracts |
| Hardware | age, per-kind failure rates compressed ×52, 2–6 h repairs, 4 h brick replacement | spares on site, partial group failures, warranty |
| Attacks | kill chains: initial access (default password / phishing without MFA / exploited CVE / backdoored vendor update / reused VPN password) → lateral moves limited by real reachability and firewall rules (OT targets over their own services) → encrypt or exfiltrate; invoice fraud as a deadline; decoys alarm when touched | real exploit code (never), persistence, EDR, attacker adaptation |
| Business | £ per affected user-minute per app (idle staff, lost sales, lost output) plus response spend against a budget; score and grade | full accounting, SLAs, reputational and regulatory cost |

---

## 8. Phases

Each phase lists its **scope** and **acceptance criteria**. A phase is done only when all its
criteria pass and a diary entry exists.

### Phase 1 — Foundation & visual language ✅
- Vite/React/TS scaffold, design tokens, glass UI shell (TopBar, Sidebar, Inspector, zoom controls).
- Engine types, Zod topology schema, node catalogue, graphology builder.
- Pixi isometric scene: hairline grid, tinted zones and labels, curved links, emoji nodes with
  ground shadows and depth sorting.
- Pan (drag), zoom (wheel/pinch around the cursor), hover lift, click-select, focus-from-sidebar,
  highlight of the selected node's links.
- Hand-authored SME sample topology (~20 nodes).
- **Done when:** typecheck is clean for app and engine; unit tests pass (iso maths, curves, schema
  invariants, graph); `vite build` succeeds; screenshot reviewed.

### Phase 2 — Simulation core ✅ (2026-11-14)
- Engine moved into a Web Worker (Comlink). Fixed-tick clock (default 4 Hz) with pause/1×/4×/step.
- Command bus and command log. Seeded RNG (mulberry32).
- Services (DNS, DHCP, AD, file, email, web, ERP, backup) hosted on nodes, with dependencies.
- Flow model: clients' demand → path (graph shortest path) → link utilisation, latency, loss.
- Node and link up/down actions. Reachability recomputed only on topology or policy changes.
- Renderer: traffic particles sampled from flows; link colour/width from utilisation; status badges.
- Floor cable routing with lanes, rounded corners and crossing gaps (§5), replacing Phase 1's arcs.
- UI: clock and speed controls (Space = pause), business services panel, activity feed, inspector
  actions (power, isolate, per-link toggles), live traffic and "Why" reasons.
- **Done when:** deterministic replay test (same seed + commands ⇒ identical snapshot hash); flow
  and reachability unit tests; stays at 60fps with 200 nodes and 2k particles.

### Phase 3 — Business generator & scale ✅ (2026-11-14)
- Onboarding wizard: name, industry, size (SME / mid / enterprise), sites, cloud vs on-prem.
- Procedural generator from templates producing zones, nodes, links, services and staff.
- **Group nodes** ("Finance · 40 laptops") with semantic zoom (they expand when zoomed in).
- Auto-layout into zones on the grid; multi-site WAN links.
- Budget, compliance and hosting choices in the wizard (decided after Phase 2), plus a live preview.
- **Done when:** generator property tests pass (all invariants hold for 500 random seeds);
  enterprise template renders smoothly.

### Phase 4 — Policy, identity & the trace tool ✅ (2026-11-15)
- Subnets/VLANs, ordered firewall rules, users, groups, permissions, MFA.
- Inspector actions: disable access, change permissions, edit rules, isolate a node.
- **Trace tool:** pick a source and destination to see the hop-by-hop path and the exact
  rule/link/permission that allows or blocks it.
- Decisions: zone-to-zone rules (plus `node:`/`tag:` selectors); roles with MFA and per-app access; click-to-click trace;
  actions stay group-wide.
- **Done when:** policy evaluation tests (rule ordering, default deny, VLAN isolation) pass and
  the trace explains every block.

### Phase 5 — Device lifecycle & firmware ✅ (2026-11-15)
- Firmware catalogue per vendor/kind with versions, CVEs, stability, features and EOL dates.
- Install flow: downtime window, reboot, brick chance, config migration; rollback.
- Hardware ageing/failure, CPU/memory load, disk full, certificate expiry.
- Decisions: real CVE numbers (modelled products, real product named); accepted outcome defaults; install now or
  tonight; random failures on by default.
- **Done when:** firmware outcome tests (seeded) pass and the vulnerability exposure view is correct.

### Phase 6 — Incidents, scenarios & scoring ✅ (2026-11-15)
- Incident state machines: ransomware, phishing → account takeover, DDoS, ISP outage, DNS
  misconfiguration, expired certificate, backup saturating the WAN, failed update, insider, edge exploit
  (in place of hardware failure, which Phase 5 already covers).
- Decisions: all ten incidents; scripted scenarios and free play; a running score plus an after-action report;
  decoys included.
- Scenario JSON (seed, topology/template, scripted and random events, objectives, budget).
- Business impact: service → function → cost/min, staff idle, SLA. Score and budget.
- Event log with causes. **Honeypot/decoy nodes** as a defensive tool.
- **Done when:** each incident has a seeded test covering progress and containment.

### Phase 7 — Undo, saves & sharing ✅ (2026-11-16)
- Undo/redo of player changes, applied *now* (no rewinding); after-action report export as `.md`.
- Named saves plus a daily autosave in IndexedDB, with a notice when it happens; copyable share codes.
- Decisions: each game is final once played (no undo during a game); no rewind or timeline scrubber;
  autosave at the start of each simulated day plus named slots; report export as Markdown; share codes
  as a code you copy.
- **Done when:** a restored save carries on identically to the original; every undoable command
  round-trips; share codes decode to the same hash.

### Phase 8 — Polish, accessibility & performance ✅ (2026-11-16)
- Dark mode (system plus a manual toggle), AA tokens with an automated contrast test, and reduced motion.
- Accessibility:
  - A table view mirroring the map (devices and connections, live status).
  - Skip links; labelled regions; dialogs that move, trap and restore focus.
  - Hidden panels made `inert`; serious alerts announced through a polite live region.
- Guided tour (10 steps):
  - Offered after creating a business, with "Don't ask again".
  - Available any time from the New business menu.
  - Ends with "▶ Play now".
- Performance: snapshot transport sends flow identity and paths only when they change, and the
  numbers as typed arrays. An enterprise push drops from 434 KB to 113 KB.
- Decisions: loading saves stays free during games; dark mode both system and toggle; tour after
  New business with "Don't ask again", re-runnable from the New business menu, urging Play at the
  end; WCAG 2.2 AA everywhere.
- **Done when:**
  - Contrast tests pass in both themes.
  - Lighthouse accessibility scores 100 in light and dark (including with a dialog open).
  - The tour runs end to end.
  - The enterprise holds ~60 fps in the production build at 16× with incidents running.

### Phase 9 — Content & tablets ✅ (2026-11-17)
- Decisions: new scenarios and new incident types; Education and Logistics industries; check every
  CVE against public sources; tablets in landscape and portrait.
- **Incidents** (14 kinds now):
  - **Compromised software update** (supply chain): backdoors land on two servers and a desktop group
    at once. They survive a password reset; "Remove the backdoored update" (2 h, £3k) evicts them.
    Exfiltration is low and slow (2 Mbps from one server), and detection comes at 8 h.
  - **Credential stuffing on the VPN:** a login storm is detected at 15 min. A reused password works
    after 30–75 min if any role lacks MFA. Turning on MFA, blocking the attacking IPs or taking the VPN
    offline in time stops it. Once in, a password reset evicts the attacker even though the VPN has
    exploitable CVEs (the foothold came from a login).
  - **Ransomware on the production line** (OT):
    - Spreads from the office to PLCs and clinical imaging devices, reaching them over their own
      services (production, imaging). Weighted 20× towards OT, and waits up to 6 extra moves to reach
      it before encrypting.
    - Restores: controller programs from the engineering backup (3 h, £3k), or a vendor re-image for
      clinical devices (4 h, £2.5k).
    - Needs OT devices to target; otherwise it's blocked.
  - **Invoice fraud** (business email compromise):
    - An urgent bank-change request to Finance, £5k + £150 per employee, with a 90–150 min deadline.
    - "Phone the supplier" (15 min) stops it. Otherwise the amount is lost.
    - If the finance role has no MFA, the mailbox itself was taken over, and a password reset is also
      needed.
- **Scenarios:** 12, with an optional `industries` filter. The Play sheet shows only those that fit the
  business, and the engine refuses a mismatch. New: The poisoned update, Dawn raid on the VPN, Payroll
  Friday, Line down (manufacturing), Clinic under siege (healthcare), Exam season (education), Peak
  dispatch (logistics).
- **Industries:**
  - **Education:** Teaching, Leadership, Finance & Admin, Pastoral & SEN and Support Staff
    departments; Student Records (MIS, `student-data`); a Parent Portal; a Student Wi-Fi zone with
    3 devices per staff member, on guest rules (internet only). Branch sites are "Campus".
  - **Logistics:** a Warehouse Floor (the factory zone kind) at HQ and in every depot, with handheld
    scanners (40% of site staff), label printers and dock cameras. Its app is "Warehouse scanning"
    to the WMS, costing £0.90 per user-minute. Branch sites are "Depot".
  - The original four industries generate byte-for-byte identically: 144 spec combinations were
    hashed against the previous commit. Old saves and share codes still load.
- **CVEs:** all 19 checked against the live NVD API and the CISA KEV feed. Four CVSS scores were
  corrected (CVE-2017-0144 8.1→8.8, CVE-2017-7921 10→9.8, CVE-2021-39238 9.3→9.8,
  CVE-2022-1161 10→9.8); every KEV flag and product attribution matched. `cve.test.ts` pins the
  checked values and the severity bands.
- **Tablets:**
  - Below 1280 px, the device list and services panel become drawers (top-bar "Devices" and
    "Services"), and the secondary actions move into a "More" disclosure.
  - Below 900 px (portrait), picking a device closes the drawer. Panels are capped to the screen
    width.
  - The top bar wraps when it must, and panels follow its measured height (`--top`).
  - Map gestures: one-finger pan, two-finger pinch-zoom plus pan.
  - Coarse pointers get 36 px targets, and the hints say "tap" and "pinch".
- **Fix:** once a game ends, attackers stop, so the after-action report stays final. Previously
  exfiltration and payouts kept growing after "Final results".
- **Done when:**
  - Every new incident has seeded tests for progress and each way to stop it.
  - Every scenario plays to the end on a business it's written for.
  - Both new industries are healthy at 10:30.
  - The CVE facts test passes.
  - Lighthouse accessibility scores 100 at tablet portrait size.

### Phase 10 — Release readiness & extensions ✅ (2026-11-20)
- Decisions: MIT licence; GitHub Actions CI; phone layouts; start a Rust/WebAssembly engine port
  and an optional FastAPI backend as drafts.
- **Branding:** the custom logo (602×314, transparent) is drawn by `ui/logo.tsx` as a CSS mask in
  the text colour, so it keeps its shape at any height and follows the theme. Square favicons
  (32/180/192/512 px, logo on a honey-yellow tile) are generated from it.
- **Custom industry artwork** for all six industries; Education and Logistics no longer fall back to
  the HQ image.
- **Repository:** `.gitignore` line 5 had been written as UTF-16, which git read as `*`, so every new
  file was silently ignored (including the README). Rewritten as plain ASCII. MIT `LICENSE`.
- **CI** (`.github/workflows/ci.yml`): web (npm ci, WASM build, typecheck, tests, build), Rust
  (fmt, clippy `-D warnings`, tests) and API (ruff, pytest; mypy reported only).
- **Generator golden hashes** (`gen/golden.test.ts`): 144 specs of the original four industries are
  hashed and compared with a fixture recorded from the Phase 8 commit (`eaffe79`), making the
  Phase 9 "byte-for-byte" check permanent.
- **Bundle:** vendor code split into `react`, `pixi` and `vendor` chunks; the app chunk is ~204 kB.
  PixiJS stays one ~670 kB chunk (a size split breaks its side-effect registration order), so the
  warning limit is 700 kB.
- **Phones and high zoom** (down to 320 px wide, i.e. 400% zoom on a 1280 px screen):
  - Top-bar clock controls and the table view header wrap.
  - Wizard: logo shrinks below `sm`; industry cards go to one column below 400 px; on screens under
    600 px tall the whole card scrolls instead of only the form.
  - Below 640 px, right-hand panels run to the bottom of the screen, and the activity feed and zoom
    buttons hide while one is open.
- **Rust → WASM draft** (`engine-rs/`, `src/wasm/`): firewall policy `decide` ported; parity-tested
  against TypeScript on all six industries. Resident interface (interned ids, typed arrays) is
  5–8× faster than TypeScript; the JSON interface is 3–4× slower and kept only for simplicity.
  Not wired into the simulation yet.
- **FastAPI draft** (`api/`): share links and scenario leaderboards; SQLite or Postgres.
- **Done when:**
  - `npm ci && npm run build:wasm && npm run check` pass on a clean clone.
  - Golden hashes match Phase 8.
  - WASM parity holds for every industry.
  - Lighthouse accessibility is 100 at 390 px and 768 px.
  - No horizontal overflow at 320 px in the wizard, top bar, drawers, sheets or inspector.

### Phase 11 — Onboarding & local progress ✅ (2026-11-21)
- Decisions (workflow doc "Honeypot — Onboarding & Next Features Workflow"): no hosted API; stay free and
  offline-first; local progress instead of leaderboards; a short, skippable onboarding.
- **Onboarding** (`ui/onboarding.tsx`, logic in `state/onboarding.ts`): one card, 4–5 steps:
  welcome → "What brings you here?" (learn fundamentals · understand threats · run a business · reviewing
  this project · just explore) → familiarity (new · some IT · IT/security) → a topic or threat (learn and
  threats only) → Ready.
  - Each topic or threat maps to one scenario that runs on the sample business; reviewers get
    "Everything, all at once" and a "How it's built" panel linking the repository.
  - Familiarity sets the suggested free-play intensity (calm · normal · intense) and the tour default.
  - "Skip to the sandbox" on every step and Esc skip; answers stored in localStorage
    (`honeypot.onboarding`), so returning visitors aren't asked again. "Your goals" in the top bar reopens it.
  - The tour checkbox on Ready replaces the separate "Take a quick tour?" pop-up for anyone who answered
    (`tour.afterBusinessCreated`); skippers still get the old offer.
  - Start: "Run a business" opens the Create a business wizard; everything else keeps the sample business
    and opens the tour, or the Play sheet with the recommended scenario first and badged.
  - Returning visitors who chose "Run a business" still start in the wizard; everyone else starts on the map.
- **Local progress** (`state/progress.ts`): best score and grade per scenario in localStorage
  (`honeypot.bests`), recorded when a scenario finishes ("New personal best" notice), shown on each
  scenario card with a "N of M completed" line.
- **Done when:** a first-time visitor reaches a running map in at most five presses or one Skip; returning
  visitors see no questions; every recommended scenario exists and fits the sample business (tested);
  Lighthouse accessibility stays at 100.

### Phase 12 — Speak the industry's language 🚧 (started 2026-11-21)
- **MITRE ATT&CK** (`engine/incidents/attack.ts`) ✅: techniques per adversarial incident kind, in attack
  order; operational incidents (outages, expired certificates, mistakes) have none. 13 IDs checked against
  attack.mitre.org on 2026-11-21 and pinned with their official names in `attack.test.ts`; T1656
  Impersonation left out (its page could not be verified). Shown as linked chips in the report sheet and
  as a line per incident in the Markdown report.
- **Incident response phases** (`engine/incidents/phases.ts`) ✅: detection (start → detected),
  containment (detected → contained) and eradication & recovery (contained → resolved), derived from the
  times each incident already records; no simulation change. MTTD, MTTC and MTTR tiles in the report
  sheet and rows in the Markdown summary; a proportional phase bar per incident, labelled in text.
- To do: threat actor profiles, an attack-graph planner (attackers search the network for a route and
  react to defences), report card export (PNG/PDF).

---

## 9. Conventions
- TypeScript `strict`. Avoid `any`. Use discriminated unions for commands and events.
- IDs are kebab-case strings (`fw-edge`, `sw-core`), stable across saves.
- Tests sit next to their source as `*.test.ts`.
- Scripts: `npm run dev`, `npm run typecheck`, `npm test`, `npm run build`, `npm run check` (all three).
- Every phase ends by appending an entry to **`BUILD_DIARY.md`** in this format:
  1. **Summary**: what was built.
  2. **Tests run**: commands, counts and results (including visual checks).
  3. **Issues found & resolved**: symptom → cause → fix.
  4. **Known limitations / debt**.
  5. **Ideas for later**.
  6. **Hand-off for the next phase**: what to provide or decide, and where to start.
