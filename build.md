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
   tool mode). The renderer reads engine snapshots directly.
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
| Tests | **Vitest** (engine and math), Chrome DevTools/Playwright for visual checks | |
| Worker RPC | Comlink *(Phase 2)* | |
| Persistence | IndexedDB via Dexie *(Phase 7)* | |

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

| Token | Hex | Use |
|---|---|---|
| `--accent` | `#0071E3` | selection, primary action |
| `--ok` | `#34C759` | online / healthy |
| `--warn` | `#FF9F0A` | degraded / at risk |
| `--bad` | `#FF3B30` | offline / failed |
| `--pwned` | `#AF52DE` | compromised |
| `--text-1/2/3` | `#1D1D1F / #6E6E73 / #86868B` | text hierarchy |

- **Zones** are soft-tinted floor plates (`internet` blue, `edge` peach, `server` lavender,
  `office` mint, `branch` sand, `cloud` sky) with a hairline outline and a small caps label.
- **Links** are thin grey curves (1.5px, 35% alpha) lifted into an arc like cables. Selection
  turns them accent blue. Downed links are dashed red.
- **Motion.** Ease-out curves of 150–250ms. Nodes lift slightly on hover. No bouncy springs.

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
  engine/        pure TS: types, schema, catalog, graph, (sim/, policy/, incidents/ later)
  render/        iso.ts + curves.ts (pure math, tested), theme.ts, scene.ts (Pixi), NetworkCanvas.tsx
  state/         store.ts (Zustand, UI state only)
  ui/            React components (glass panels)
  data/          topology & scenario JSON
public/emoji/    Fluent 3D emoji PNGs (MIT)
```

### Isometric maths
- Tile size: `TILE_W = 96`, `TILE_H = 48` (2:1 dimetric).
- `project(x, y) = { sx: (x − y)·W/2, sy: (x + y)·H/2 }`. `unproject` is the exact inverse.
- Draw order: `zIndex = (x + y)·1000 + x` for nodes. Links are drawn under nodes.
- Grid +x runs to the lower right on screen, +y to the lower left. Traffic generally flows
  "top" (Internet, small x+y) to "bottom" (office, large x+y).

### Link curves
Cubic Bézier between the two node anchor points. Both control points are lifted vertically by
`lift = clamp(dist·0.22, 14, 90)` px so links read as cables arching between devices. Particles
and hit-testing sample the same curve (`curves.ts`).

---

## 6. Domain model (grows by phase)

```ts
NodeKind = internet | isp | router | firewall | switch | wifi | server | database | nas
         | desktop | laptop | phone | printer | cloud | camera | voip | pos | vpn | honeypot | user
ZoneKind = internet | edge | server | office | branch | cloud | guest
NetNode  { id, kind, label, zoneId, pos{x,y}, ip?, vlan?, os?, firmware?{vendor,version},
           status: online|offline|degraded|compromised, services[], tags[] }
Link     { id, a, b, medium: fiber|copper|wifi|wan|vpn, bandwidthMbps, latencyMs, status: up|down }
Zone     { id, name, kind, origin{x,y}, size{w,h} }
Topology { meta{ name, industry, size: sme|mid|enterprise, employees, seed }, zones[], nodes[], links[] }
```
Topology invariants (enforced by `TopologySchema`): unique ids; links reference existing nodes;
no self-links or duplicate links; each node lies inside its zone; at most one node per tile.

**Planned additions:** Phase 2 `Service`, `Flow`, `Command`. Phase 4 `Subnet`, `Vlan`,
`FirewallRule`, `Identity`, `Group`, `Permission`. Phase 5 `FirmwareRelease`, `Vulnerability`.
Phase 6 `Incident`, `Scenario`, `Objective`.

---

## 7. Abstraction ledger (what we simulate and what we don't)

| Area | Simulated | Abstracted away |
|---|---|---|
| Traffic | flows per service pair: demand Mbps, utilisation, latency, loss | packets, TCP behaviour, MTU |
| L2 | VLAN membership, trunk vs access, switch failure | STP, MAC tables, ARP |
| L3 | subnets, default gateways, static routing between zones, NAT at edge | dynamic routing protocols (BGP/OSPF) except as "ISP up/down" |
| Policy | ordered firewall rules (src zone/subnet, dst, service, allow/deny), ACLs | stateful inspection internals |
| Identity | users, groups, role permissions on services, MFA on/off, privileged accounts | Kerberos/LDAP internals |
| Devices | status, CPU/mem load as %, firmware version, config flags, lifespan | real OS behaviour |
| Firmware | catalogue with CVEs, stability, features, update downtime, brick risk, config compatibility | binary images |
| Attacks | kill-chain state machines (recon → initial access → lateral → impact) with probabilities | real exploit code (never) |
| Business | services → business functions → cost/minute, staff idle, SLA | full accounting |

---

## 8. Phases

Each phase lists its **scope** and **acceptance criteria**. A phase is done only when all its
criteria pass and a diary entry exists.

### Phase 1 — Foundation & visual language
- Vite/React/TS scaffold, design tokens, glass UI shell (TopBar, Sidebar, Inspector, zoom controls).
- Engine types, Zod topology schema, node catalogue, graphology builder.
- Pixi isometric scene: hairline grid, tinted zones and labels, curved links, emoji nodes with
  ground shadows and depth sorting.
- Pan (drag), zoom (wheel/pinch around the cursor), hover lift, click-select, focus-from-sidebar,
  highlight of the selected node's links.
- Hand-authored SME sample topology (~20 nodes).
- **Done when:** typecheck is clean for app and engine; unit tests pass (iso maths, curves, schema
  invariants, graph); `vite build` succeeds; screenshot reviewed.

### Phase 2 — Simulation core
- Engine moved into a Web Worker (Comlink). Fixed-tick clock (default 4 Hz) with pause/1×/4×/step.
- Command bus and command log. Seeded RNG (mulberry32).
- Services (DNS, DHCP, AD, file, email, web, ERP, backup) hosted on nodes, with dependencies.
- Flow model: clients' demand → path (graph shortest path) → link utilisation, latency, loss.
- Node and link up/down actions. Reachability recomputed only on topology or policy changes.
- Renderer: traffic particles sampled from flows; link colour/width from utilisation; status badges.
- **Done when:** deterministic replay test (same seed + commands ⇒ identical snapshot hash); flow
  and reachability unit tests; stays at 60fps with 200 nodes and 2k particles.

### Phase 3 — Business generator & scale
- Onboarding wizard: name, industry, size (SME / mid / enterprise), sites, cloud vs on-prem.
- Procedural generator from templates producing zones, nodes, links, services and staff.
- **Group nodes** ("Finance · 40 laptops") with semantic zoom (they expand when zoomed in).
- Auto-layout into zones on the grid; multi-site WAN links.
- **Done when:** generator property tests pass (all invariants hold for 500 random seeds);
  enterprise template renders smoothly.

### Phase 4 — Policy, identity & the trace tool
- Subnets/VLANs, ordered firewall rules, users, groups, permissions, MFA.
- Inspector actions: disable access, change permissions, edit rules, isolate a node.
- **Trace tool:** pick a source and destination to see the hop-by-hop path and the exact
  rule/link/permission that allows or blocks it.
- **Done when:** policy evaluation tests (rule ordering, default deny, VLAN isolation) pass and
  the trace explains every block.

### Phase 5 — Device lifecycle & firmware
- Firmware catalogue per vendor/kind with versions, CVEs, stability, features and EOL dates.
- Install flow: downtime window, reboot, brick chance, config migration; rollback.
- Hardware ageing/failure, CPU/memory load, disk full, certificate expiry.
- **Done when:** firmware outcome tests (seeded) pass and the vulnerability exposure view is correct.

### Phase 6 — Incidents, scenarios & scoring
- Incident state machines: ransomware, phishing → account takeover, DDoS, ISP outage, DNS
  misconfiguration, expired certificate, backup saturating the WAN, failed update, insider, hardware failure.
- Scenario JSON (seed, topology/template, scripted and random events, objectives, budget).
- Business impact: service → function → cost/min, staff idle, SLA. Score and budget.
- Event log with causes. **Honeypot/decoy nodes** as a defensive tool.
- **Done when:** each incident has a seeded test covering progress and containment.

### Phase 7 — Time travel & persistence
- Undo/redo, replay timeline scrubber, after-action report.
- Save/load in IndexedDB, export/import JSON, share codes (seed + command log).

### Phase 8 — Polish, accessibility & performance
- Accessible table view that mirrors the canvas, keyboard navigation, reduced-motion support,
  dark mode, guided tutorial scenario, performance budget pass.

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
