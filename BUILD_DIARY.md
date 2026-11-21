# Build Diary

Entries are appended after each phase (format in `build.md` §9). The newest entry goes at the bottom.

---

## Phase 1 — Foundation & visual language · 2026-11-14 · ✅ complete

### 1. Summary
- **Scaffold:** Vite 8 + React 19 + TypeScript 7 (strict, `noUncheckedIndexedAccess`), Tailwind 4, Pixi 8,
  Zustand 5, Zod 4, graphology. Scripts: `dev`, `typecheck`, `test`, `build`, `check`.
- **Engine (`src/engine`, pure TS):**
  - `model.ts`: node, zone and link kinds; Zod schemas; topology invariants; `parseTopology` → `TopologyError`.
  - `catalog.ts`: human-facing labels and descriptions per node kind, medium labels, bandwidth formatting.
  - `graph.ts`: graphology builder, `neighbours`, `reachableFrom` (respects link-down and node-offline), `components`.
- **Sample business:** `src/data/harbour-finch.json`, a 24-staff accountancy with **24 devices, 23 links and 4 zones**
  (Internet, Edge & DMZ, Server Room, Office Floor). The data is realistic, with deliberate weak spots for later
  phases: an EOL Windows 10 PC, a Windows Server 2016 database, a CCTV camera tagged `default-credentials`,
  BYOD mobiles and a privileged partner laptop.
- **Renderer (`src/render`):**
  - `geometry.ts` (pure): 2:1 isometric projection/inverse, tile picking, depth key, cable Bézier, curve sampling and distance.
  - `scene.ts` (Pixi): hairline world grid; zone floor plates with thickness, tile lines and floor-projected
    labels; cable-arc links (dashed for Wi-Fi/VPN); 3D emoji nodes with soft ground shadows, depth sorting,
    hover lift, a pulsing selection ring, accent highlight of connected links, dimming of unrelated nodes and
    zoom-dependent labels; smooth camera with drag pan, wheel/pinch zoom around the cursor, trackpad pan,
    fit and focus.
  - `NetworkCanvas.tsx`: the only React↔Pixi bridge, synced through `useApp.subscribe` (no re-renders).
- **UI (`src/ui`, `App.tsx`):** Apple-style glass TopBar, a searchable Sidebar grouped by zone, a slide-in
  Inspector (details, services/tags, clickable connections), zoom controls with a % readout, a hint pill and
  Esc to deselect.
- **Assets:** 26 Fluent Emoji 3D PNGs in `public/emoji/` (MIT, licence included).

### 2. Tests run
| Check | Command | Result |
|---|---|---|
| App typecheck | `tsc -p tsconfig.json` | ✅ 0 errors |
| Engine purity typecheck (no DOM lib) | `tsc -p tsconfig.engine.json` | ✅ 0 errors |
| Unit tests | `npm test` | ✅ **19 / 19** passed (2 files) |
| Production build | `npm run build` | ✅ built in ~1.1 s (see debt: 724 kB chunk) |
| Visual check, initial load | Chrome DevTools at 1440×900 | ✅ renders, **0 console errors/warnings** |
| Visual check, selection | clicked "Edge Firewall" in the Sidebar | ✅ camera focuses, 4 links turn accent, others dim, Inspector opens with correct data |

Unit test coverage:
- **Schema (5):** accepts the sample and applies defaults; rejects duplicate IDs; rejects unknown-node,
  self and duplicate links; rejects out-of-zone nodes and shared tiles; rejects overlapping zones,
  non-kebab IDs and invalid IPv4.
- **Graph (5):** single component; firewall neighbours; full reachability from the core; core→floor
  uplink down isolates the office; an offline firewall partitions the network.
- **Geometry (9):** axis projection; project/unproject round-trip; `tileAt`; depth ordering;
  zone bounds; curve endpoints; upward arc; lift clamping; distance-to-curve.

### 3. Issues found & resolved
| Symptom | Cause | Fix |
|---|---|---|
| `TS7053` indexing the result of `Assets.load` | The generic `<Texture>` types an array load as a single `Texture` | Typed the result as `Record<string, Texture>` (keyed by src) |
| Test expected 23 devices | Miscount in the test (the sample has 3+4+5+12 = 24) | Corrected the assertion; the data was right |
| Map stuck at 30% zoom and off-centre after the window resized | `fit()` ran once at mount with the initial viewport | Refit on renderer `resize` until the user pans or zooms (`userMoved` flag) |
| Apple emoji artwork can't be shipped (proprietary) | Licensing | Switched to Microsoft Fluent Emoji 3D (MIT), recorded in build.md §3 |
| Possible React StrictMode double-mount crash in Pixi | `app.destroy()` throws if called before `init()` resolves | `destroy()` waits for the init promise and uses `releaseGlobalResources` |

### 4. Known limitations / debt
- **Bundle size:** 724 kB (207 kB gzipped) single chunk, mostly Pixi. Code-split the scene with `import()` in Phase 8.
- The topology sits in the Zustand store because it's static. **It must move into the engine worker in
  Phase 2** (principle §2.2).
- Node hit areas are the sprite rectangles, including transparent corners. They're fine at this density
  but should become alpha-aware or polygonal when nodes get denser.
- Link hover/click isn't implemented yet (`distanceToCurve` is ready for it).
- Light theme only. There's no keyboard navigation of the canvas yet (the Sidebar is keyboard accessible).
- Labels hide below about 55% zoom to reduce clutter; group-level labels are needed for Phase 3 scale.
- The tooling has no ESLint config yet.

### 5. Ideas for later
- Floor "rooms" with low walls for the server room, giving a stronger sense of physical space.
- A minimap in the bottom-left corner for large enterprise topologies.
- A link inspector showing medium, bandwidth, latency and (Phase 2) live utilisation sparkline.
- A "risk lens" overlay that colours nodes by tags (`end-of-life-os`, `default-credentials`, `internet-facing`).
- Swap the 256px PNGs for a single texture atlas (fewer requests, better batching).
- Ambient touches such as a subtle day/night tint tied to sim time, and gentle idle float on cloud nodes.

### 6. Hand-off for Phase 2 — Simulation core
**Start at:** `build.md` §8 Phase 2. Create `src/engine/sim/` with `rng.ts` (mulberry32), `clock.ts`,
`commands.ts` (discriminated union and reducer), `services.ts`, `flows.ts`, then `worker.ts` + Comlink.

**Decisions needed from you:**
1. **Service catalogue for the sample:** confirm the service dependency chain I'll use by default,
   e.g. *every client → DNS (dc-01) → directory login → file/SQL/SaaS*, with backups running nightly NAS → cloud.
2. **Time scale:** proposed 1 real second = 1 simulated minute at 1× speed, with a working day of 08:00–18:00.
3. **Traffic realism:** default per-user demand profiles (office worker approx. 2–5 Mbps average with
   bursts, backup 300 Mbps at night, VoIP 0.1 Mbps but latency-critical). Accept these or provide your own.
4. **First user actions to wire:** proposed *disable/enable link*, *power off/on device*, *isolate device*.

**Acceptance for Phase 2:** deterministic replay hash test, flow and reachability tests, and 60 fps with
200 nodes and 2k particles.

---

## Phase 2 — Simulation core + floor cable routing · 2026-11-14 · ✅ complete

### 1. Summary
- **Decisions confirmed by you:** the DNS → sign-in → app dependency chain; 1 real second = 1 simulated minute at 1×;
  the proposed demand profiles; first actions = link up/down, power on/off, isolate.
- **New request delivered:** cables now lie **on the floor along the isometric axes with rounded corners**. Cables
  sharing a run sit in **parallel lanes 7px apart** (so they plug into a device side by side, not one centre point),
  and where two cables cross, the lower one has a **small gap** (`src/render/routing.ts`, build.md §5).
- **Engine (`src/engine/sim/`, pure TS):**
  - `rng.ts`: mulberry32, FNV-1a, a stateless `noise(seed, n)` (order-independent per-flow noise) and derived seeds.
  - `clock.ts`: fixed 15-second ticks; speed changes ticks per second, never tick size, so it is deterministic at
    any speed. Also the workday curve (lunch dip, weekends) and backup windows that wrap past midnight.
  - `demands.ts`: demands derived from node kinds and hosted services, covering 11 business apps (staff apps,
    portal, VPN via waypoint, voice, CCTV, nightly local and offsite backups).
  - `commands.ts`: a Zod-validated discriminated union; `simulation.ts` logs each command against its tick.
  - `simulation.ts`:
    - Each tick computes demand → dependency checks → shortest path (only forwarding devices carry transit) →
      per-direction link load → proportional squeeze, queueing latency and loss → flow, node and app health → events.
    - Path trees are cached and rebuilt only after a command.
    - Every failure carries a human reason, e.g. *"DNS unavailable: Domain Controller is powered off"* or
      *"No route to File Server: link Core Switch ↔ Floor Switch is down"*.
    - `Simulation.replay(topology, seed, log, ticks)` rebuilds a session from its command log.
- **Worker:** `src/worker/sim.worker.ts` (Comlink `SimHost`) drives the clock and pushes snapshots at ≤10 Hz plus
  one per command. `src/state/sim.ts` is the main-thread mirror (`useSim`) and command facade.
- **Renderer:**
  - Routed cables with live styling: utilisation colour, down = dashed red, blocked = faint dashed grey.
  - Status badges, and offline devices fade.
  - A 2,400-particle pool in a `ParticleContainer` shows flows moving along their real cable paths in the bulk
    direction, coloured by category; particles not involved with the selected device dim.
- **UI:**
  - Clock and 1×/4×/16× speeds, pause (Space) and step.
  - A Business services panel with "busiest links".
  - An Activity feed (click an event to jump to its device).
  - Inspector additions: a "Why" box, Power off/on, Isolate/Reconnect, Live traffic, and a per-connection link
    toggle with a utilisation bar.
  - An error toast for rejected commands.
- **Stress mode:** `?stress=200` loads a synthetic 205-device enterprise (`src/engine/stress.ts`).

### 2. Tests run
| Check | Command | Result |
|---|---|---|
| App typecheck | `tsc -p tsconfig.json` | ✅ 0 errors |
| Engine purity typecheck | `tsc -p tsconfig.engine.json` | ✅ 0 errors (sim code has no DOM) |
| Unit tests | `npm test` | ✅ **49 / 49** passed (4 files) |
| Production build | `npm run build` | ✅ ~1.1 s; worker bundled separately (115 kB) |
| Visual: live sample | Chrome, 1536×842 | ✅ cables on floor with lanes and rounded corners, particles flowing, 0 console errors/warnings |
| Visual: action | Sidebar → Domain Controller → Power off | ✅ badge red and sprite faded; link "blocked"; feed shows "Web browsing down: DNS unavailable: Domain Controller is powered off" (and others); services panel and sidebar dots update |
| **Performance acceptance** | `?stress=200` at 16× for 6 s, rAF timing + `__honeypotScene.stats()` | ✅ **60.2 fps**, worst frame 17.4 ms, 0 frames > 20 ms with **205 nodes, 204 links, 720 flows, 2,071 particles** |

New unit tests (30):
- **rng (2):** reproducible and in range; noise is stateless and well spread.
- **clock (3):** formatting; workday curve (lunch, night, Saturday); wrap-around windows.
- **demands (2):** counts per app from the sample; an office worker totals 2–5 Mbps.
- **Healthy day (4):** all apps OK at 10:30; paths use forwarding devices only (VPN hairpins through the firewall);
  bulk direction is right; the overnight offsite backup uses 50–70% of the 500 Mbps WAN.
- **Failures (5):** ISP link down (cloud apps down, internal OK, exact reason); DC off (DNS chain breaks, CCTV and
  portal unaffected); core→floor uplink cut (reason names the link); isolate (link blocked, device powered);
  a powered-off switch is not used as transit.
- **Congestion (3):** an 8 Mbps uplink saturates (throughput squeezed, latency > 100 ms, saturation event); voice
  degrades on a thin WAN; queue-delay bounds.
- **Commands (3):** malformed, unknown and external targets rejected without logging; no-ops ignored;
  reachability recomputed only after a command.
- **Determinism (3):** same seed + commands ⇒ identical hash and events over 1,970 ticks; replay from the log ⇒
  identical hash; a different seed ⇒ a different hash.
- **Routing (7):** every link routed; straight sections are axis-aligned; never under another device; no two cable
  ends closer than a lane; parallel cables ≥ 0.6 lane apart; **no visible crossings** after gaps; deterministic.
- **Scale (2):** the 200-node engine runs < 5 ms per tick; routing 204 links takes < 1.5 s.

### 3. Issues found & resolved
| Symptom | Cause | Fix |
|---|---|---|
| A link that was congested from the very first tick never produced an event | The quiet initial evaluation recorded state, so no transition was ever seen | The initial evaluation is now fully silent and records nothing; tick 1 announces existing problems |
| Test expected `files` to be idle at 02:30 | Overnight demand is a 3% trickle by design (sync, updates) | The test now asserts staff traffic < 0.5 Mbps overnight |
| Voice did not degrade on a 25 Mbps WAN | The WAN was actually at ~70%, so not congested | The test uses 12 Mbps; the model was right |
| Demand count test off by one | Miscount: the sample has 3 desktops, not 4 | Corrected the test |
| My scripted removal of curve code also deleted the `vitest` import | Over-broad regex | Restored the import; geometry tests pass |
| Port 5179 already in use when starting Vite | A dev server for this project was already running | Used the existing server (HMR) and left it running |
| Particles looked heavy when zoomed in | Scale 0.42 of a 6px dot | Reduced to 0.34 |

### 4. Known limitations / debt
- **Main bundle 770 kB** (221 kB gz). Code-split the Pixi scene in Phase 8.
- Congestion uses proportional scaling, not max-min fairness, and a squeezed flow doesn't free capacity elsewhere
  (one pass). Good enough for cause and effect; recorded in §7.
- Wi-Fi is modelled as a per-client link rather than shared airtime, so an AP never saturates from many clients.
- Crossing gaps are only computed between straight sections; a crossing inside a corner arc (rare) would not be
  gapped. Routing runs once, so cables don't re-route when a link fails (the physical cable stays where it is,
  which is realistic).
- At 30% zoom the particles are barely visible, which is acceptable, but a zoom-aware particle size would help.
- There's no clickable link on the canvas yet; links are toggled from the Inspector.
- `useSim` selectors for flows/apps re-render their panels at ~10 Hz while visible. Fine at this size; memoise by
  key if the UI grows.

### 5. Ideas for later
- Link hover tooltip on the canvas (utilisation, Mbps each way, flows) using `routing.pointAlong` hit-testing.
- "Follow a flow": click a Live traffic row to highlight its whole path and dim everything else (a precursor to
  the Phase 4 trace tool).
- Time-of-day tint (cooler at night) and a mini 24 h utilisation sparkline per link in the Inspector.
- A "jump to" menu on the clock (lunch, 22:00 backups, Monday 09:00) for quicker demos.
- Cable bundles could be drawn as a single soft "tray" underlay when ≥4 lanes share a run.

### 6. Hand-off for Phase 3 — Business generator & scale
**Start at:** `build.md` §8 Phase 3. Create `src/engine/gen/` with templates (SME / mid / enterprise × industry).
It should output a `TopologyInput` that `deriveDemands` understands: clients by kind, servers advertising
services such as `dns`, `directory`, `smb`, `sql`, `https`, `ipsec`, `backup` and `sip`. Then add the onboarding
wizard, group nodes with semantic zoom, and multi-site WAN. `routeLinks` already handles 200+ nodes.

**Decisions needed from you:**
1. **Industries for templates:** proposed *professional services* (like the sample), *retail* (POS terminals,
   guest Wi-Fi, a branch per store), *healthcare clinic* (strict data zone), *manufacturing* (OT/factory zone).
   Keep, trim or add?
2. **Scale targets:** SME 10–50 staff, mid 50–250 (2–3 sites), enterprise 250–2,000 (5+ sites, grouped nodes).
   Is that right?
3. **Grouping threshold:** collapse identical endpoints into a group node ("Finance · 40 laptops") above about 12
   per zone?
4. **Wizard fields:** name, industry, size, number of sites, and cloud-first vs on-premises. Anything else (budget,
   compliance needs)?

**Acceptance for Phase 3:** generator property tests (all invariants hold for 500 random seeds), the enterprise
template renders smoothly, and generated businesses produce healthy days in the simulation.

---

## Phase 3 — Business generator & scale · 2026-11-14 · ✅ complete

### 1. Summary
- **Decisions confirmed by you:** the four industry templates; SME 10–50 / Mid 50–250 / Enterprise 250–2,000 staff
  with 1–2 / 2–3 / 5–8 sites; grouping above 12 devices per zone; the wizard also asks about **budget** and
  **compliance** (and hosting).
- **Schema (`engine/model.ts`):**
  - New node kinds `plc` and `medical`, and zone kinds `factory`, `clinical` and `secure`.
  - Nodes gain `count` (group nodes) and `subnet`; zones gain `site`; links gain `dependsOn` for VPN overlays,
    validated as a chain from `a` to `b`.
  - `meta.profile` records the business choices.
- **Generator (`engine/gen/`):** `BusinessSpec` (Zod-validated) → `generateBusiness` → `TopologyInput`, pure and
  seeded. It covers:
  - Industry templates (departments, line-of-business system, portal, specials).
  - Multi-site plans with branch broadband plus VPN tunnels (and a private WAN when the budget is generous).
  - Cloud-first vs on-prem estates.
  - Budget-driven sizing: every link is sized from expected demand × headroom and rounded up to a real tier.
  - EOL and default-credential rates, plus compliance segmentation (PCI zone, clinical/OT VLANs).
  - An IP/VLAN plan, firmware, a column layout with cable corridors, and `summarise()` for the preview.
- **Simulation upgrades:**
  - Groups scale demand and count users.
  - DNS and sign-in can use any reachable host.
  - VPN tunnels depend on, and load, their underlay.
  - New edge rule: traffic that has crossed the internet can't enter private zones.
  - New apps: card payments, production line control, medical imaging.
  - `startTick` option.
  - Per-demand path cache (resolution only after commands).
- **UI:**
  - **Onboarding wizard** (glass modal) with industry cards (3D emoji), size segmented control, a staff slider,
    a sites stepper, hosting, budget and compliance chips, "Surprise me", and a live preview (≈ devices · map
    nodes · zones · sites · internet speed). It also offers "Use the sample business".
  - "New business…" in the top bar, with compliance chips.
  - The worker reloads per business (epoch-guarded), and the canvas remounts per topology.
  - **Group nodes:** stacked icon and count pill; a crowd when zoomed in. **Zone overview tags** when zoomed out.
  - Inspector shows "Group of N", device count and subnet. The Sidebar shows group counts. Services read users
    affected, and the business-system app takes its server's name (e.g. "Stock & ERP").

### 2. Tests run
| Check | Command | Result |
|---|---|---|
| App + engine typecheck | `npm run typecheck` | ✅ 0 errors |
| Unit tests | `npm test` | ✅ **74 / 74** passed (5 files, ~9 s) |
| Production build | `npm run build` | ✅ 1.4 s (main chunk 806 kB, see debt) |
| **Property test: invariants** | 500 random specs → `parseTopology` | ✅ all valid, single component, < 450 map nodes; grouping rule holds; ≥ 1 device per employee |
| **Property test: healthy morning** | 100 random specs simulated at 10:30 | ✅ no app down in any; no app degraded for standard/generous budgets |
| Template matrix | 4 industries × 3 sizes | ✅ valid, connected, every app healthy at 10:30 |
| Visual: wizard | Chrome 1536×842 | ✅ renders; preview updates live; Retail · Mid · 3 sites → "≈ 385 devices · 86 on the map · 8 zones · 3 sites · 1.0 Gbps internet" |
| Visual: generated retailer | Create network | ✅ HQ, two stores, two PCI zones, groups with count pills, zone tags at overview zoom, all services healthy |
| Visual: group + inspector | Shopper Wi-Fi guests | ✅ crowd at 115%, "Group of 73", subnet 10.2.90.0/24, 58 Mbps web traffic |
| Regression: select then load a new business | scripted in Chrome | ✅ no crash (was a crash, see issues) |
| **Enterprise acceptance** | Manufacturing · 2,000 staff · 8 sites at 16× for 6 s | ✅ **60.2 fps**, worst frame 17.7 ms, 0 frames > 20 ms. **5,640 devices** as 239 map nodes, 245 links, 384 flows, 2,265 particles. 0 console errors |

New tests (25): spec validation and tiers (2); template matrix (12); determinism (1); 500-seed invariants (1);
100-seed healthy mornings (1); budget, hosting, compliance and industry effects (4); multi-site tunnel routing,
underlay loading, HQ-outage behaviour and user counting (4).

### 3. Issues found & resolved
| Symptom | Cause | Fix |
|---|---|---|
| Stores lost card payments when head-office internet failed | Store DNS resolved only via the HQ domain controller through the tunnel | Branch routers run a local DNS forwarder (as real ones do); internal apps still fail because sign-in needs the tunnel. This is now a test |
| Property test "desktops+laptops ≥ 40% of staff" failed for retail | Shop staff don't each have a PC | The property is now "≥ 1 device per employee" (tills and handsets count) |
| Simulation got slower (5.4 ms/tick on 200 nodes) | `linkUsable` built explanation strings in the Dijkstra hot loop, and every demand re-resolved each tick | Boolean `linkUsable` (strings only in `linkProblem`); per-demand resolution cache cleared by commands |
| 100-seed test hit Vitest's 5 s default timeout | It simulates 100 businesses | Explicit 60 s / 120 s timeouts on the property tests |
| **Crash:** loading a new business while a device was selected | The Inspector kept the previous node during its slide-out and looked up its neighbours in the new graph | Forget the remembered node if it isn't in the current graph |
| Enterprise map at 45–50 fps, worst when paused | Hundreds of alpha-0 objects (selection rings, labels, group crowds) still went through the renderer | Toggle `visible` with alpha → 60 fps |
| Zone overview tags overlapped on small zones | Tags are screen-sized, zones shrink with zoom | Show a tag only when its zone is wider on screen than the tag |
| Sidebar said "239 devices" for a 5,640-device business | It counted map nodes | Now "5,640 devices · 239 on map" |
| Shell heredoc and `node -e` quoting mangled two scripted edits (regex, template strings) | Bash quoting | Fixed with direct edits; larger doc edits now go through scratchpad scripts |

### 4. Known limitations / debt
- **Bundle 806 kB** (233 kB gz); the generator and wizard add to it. Lazy-load the wizard and code-split Pixi (Phase 8).
- Groups are aggregates: you can't yet isolate one laptop in a group of 40 (actions apply to the whole group).
- VPN tunnels are pinned to the primary ISP; with a backup ISP they don't fail over (the private WAN does).
- Tunnel cables are routed on the floor like any other cable and can take long detours around the map.
  A future option is drawing overlays as faint "in the air" arcs, or hiding them until selected.
- Overview tags can still overlap when two big zones are diagonal neighbours.
- Generated layouts are column-based and functional rather than beautiful (no rooms, no per-site clustering).
- Overnight, the offsite backup is a fixed 300 Mbps, so modest ISPs saturate between 01:00 and 05:00. That's
  realistic and teachable, but it may surprise people.
- The wizard isn't keyboard-trapped (focus can leave the dialog) and the slider has no numeric input; a11y pass
  in Phase 8.

### 5. Ideas for later
- "Surprise me" could also pick a scenario (e.g. "lean budget retailer before Black Friday").
- Shareable business codes: the BusinessSpec plus seed is tiny. Encode it in the URL (pairs with Phase 7).
- A per-site minimap or site filter for enterprises; collapse whole branch sites into one node at far zoom.
- A risk lens: colour nodes by tags (`end-of-life-os`, `default-credentials`, `flat-network`, `pci-scope`).
  The generator now produces these deliberately.
- Budget as a live constraint: upgrading a link costs money (feeds Phase 6 scoring).

### 6. Hand-off for Phase 4 — Policy, identity & the trace tool
**Start at:** `build.md` §8 Phase 4. Create `src/engine/policy/` with VLAN and subnet membership, ordered firewall
rules evaluated at zone boundaries, identities and permissions. The sim's edge rule becomes the default
inbound policy. Then add Inspector actions (disable access, change permissions, edit rules) and the trace tool.

**Decisions needed from you:**
1. **Rule model:** proposed zone-to-zone rules (`source zone/VLAN → destination zone/host, service, allow|deny`,
   first match wins, default deny inbound, allow outbound). The generator writes a sensible default per
   compliance choice (e.g. PCI zone may only reach "Card Payments"). Is that granularity right, or do you want
   per-device rules too?
2. **Identity:** proposed users per department group with roles (staff, manager, IT admin, partner/clinician),
   MFA on/off per role, and permissions per app (e.g. Finance → business system: write). Budget sets the default
   MFA coverage (lean: admins only; generous: everyone). OK?
3. **Trace tool UX:** proposed "Trace" mode: click a source, then a destination (or pick an app). The Inspector
   then shows hop-by-hop with ✓/✗ and the exact rule, link or permission responsible, highlighted on the map.
   Good?
4. **Groups and actions:** keep actions group-wide in Phase 4, or add "split one device out of a group" now?

---

## Phase 4 — Policy, identity & the trace tool · 2026-11-15 · ✅ complete

### 1. Summary
- **Decisions confirmed by you:** zone-to-zone firewall rules are detailed enough; roles with MFA and per-app
  permissions; click-a-source, click-a-destination trace; actions stay group-wide.
- **Model:**
  - `policy.rules` (ordered; selectors `any`, `kind:`, `zone:`, `node:`, `tag:`; services per app or `dns` /
    `directory`).
  - `identity.roles` (MFA plus per-app none/read/write) and `node.role`.
  - The schema validates selectors and that referenced zones and devices exist.
- **Engine (`engine/policy/policy.ts`, pure):** `decide()` (same zone not filtered → first matching enabled rule
  → default policy), selector matching, roles, and human descriptions of selectors.
- **Simulation:**
  - Firewall checks on every flow leg and on the DNS and sign-in lookups.
  - Role permission checks.
  - A per-rule "blocking N users" count in the snapshot.
  - Eight new commands (add, update, move and remove rule; disable access; set role; set access; set MFA),
    all replayable.
  - `trace()`, which explains device → DNS → sign-in → permission → firewall → every hop, marking the first ✗ and
    the would-be path beyond it.
- **Generator:** writes a default policy from the compliance choices (guest isolation, PCI card data environment,
  clinical and OT fencing). It assigns roles (finance → manager, partners and clinicians → privileged, an IT admin
  laptop → IT admin) and sets MFA coverage by budget.
- **UI:**
  - "Trace" and "Policy" buttons in the top bar.
  - Trace panel: from/to slots, swap, service picker (automatic by default), verdict banner, and a ✓/✗ step
    list. Steps can be clicked to jump to a device or open the rule or role. It refreshes every second.
  - Map highlighting for the traced path.
  - Policy sheet with a **Firewall rules** tab (reorder, enable/disable, delete, live "blocking N users", add-rule
    form with zone, zone-type, tag and server pickers, placed at top or bottom) and an **Access & MFA** tab (role ×
    app matrix, MFA switches, user counts).
  - Inspector: **Disable / Restore access**, **Trace from here**, **Edit firewall rules** (on firewalls) and a
    **Role** picker (group-wide).

### 2. Tests run
| Check | Command | Result |
|---|---|---|
| Typecheck (app + engine) | `npm run typecheck` | ✅ 0 errors |
| Unit tests | `npm test` | ✅ **93 / 93** passed (6 files, ~7.6 s) |
| Build | `npm run build` | ✅ ~1.1 s |
| Property tests with default policies | 500 invariants + 100 healthy mornings (now with generated rules and roles) | ✅ no app down; no app degraded for standard/generous budgets, so default rules never block legitimate traffic |
| Visual: PCI trace | Retail · Mid → Trace from card terminals to the domain controller | ✅ ✗ at "Blocked by rule “Card data environment: nothing else out”", with zone crossing shown and the path drawn red |
| Visual: policy sheet | Policy → Firewall rules | ✅ 7 generated rules (guest ×3, PCI ×4), toggles, reordering |
| Visual: add a rule | Form: deny Office zones → Server Room zones · Stock & ERP, at top | ✅ inserted at #1; "blocking 24 users"; Stock & ERP degraded; two events logged |
| Visual: access matrix | Access & MFA tab | ✅ roles with user counts, MFA switches, per-app selects |
| Visual: disable access then trace | Sample → Accounts PC 1 → Disable access → Trace from here → File Server | ✅ "Why" lists each blocked app with the rule; trace fails at the DNS step naming the rule; path red; 0 console errors |

New tests (19): rule evaluation (same zone, first match, services, disabled rules, zone/node/tag selectors,
default inbound deny); schema rejects bad selectors and dangling references; disable and restore access with the
blocking count; rule ordering via add, move and disable; DNS blocked at the firewall names the rule; invalid rule
commands rejected; role access none → denied, role change → restored; MFA flag; generated PCI and guest policies via
trace; role and MFA defaults by budget; trace for working, broken-link, rule-blocked and inbound-denied cases;
deterministic replay including policy and identity commands.

### 3. Issues found & resolved
| Symptom | Cause | Fix |
|---|---|---|
| A rule-blocked trace drew the path blue (looked like success) | Path colour only handled link failures | Policy blocks draw red throughout; link breaks draw blue → red → grey |
| The trace verdict repeated the rule name twice | Title and detail both carried the reason | Title "Blocked by rule “X”", detail is the zone crossing |
| Traffic particles crowded the traced path | Particles only dimmed for a selection | Particles dim whenever a trace is shown |
| Generated businesses had nobody in the IT admin role | No IT staff in the templates | One IT admin laptop at HQ (three for enterprise), tagged `admin`, role `it-admin` |
| UI copy mentioned "Phase 6" | Build jargon leaked into the product | Reworded |
| Stress timing test failed only in the full run (6.7 ms > 5 ms) | Wall-clock budget too tight while other test files run in parallel (1.2 s alone) | Budget set to 10 ms against the real 15.6 ms/tick need at 16×, with the reason in the test |
| Routing "lanes apart" test timed out only in the full run | Hundreds of thousands of `expect()` calls under parallel load | Collect violations, assert once |
| A replacement left a stray closing brace in `simulation.ts`; bash quoting broke template literals twice | My scripted edits | Fixed with direct edits; no more inline `node -e` for JSX/template code |
| Editing engine files made the dev page reload to the wizard mid-check | Worker module changes force a full reload under HMR | Expected in dev; visual scripts now recreate their business first |

### 4. Known limitations / debt
- The firewall is one logical policy evaluated end to end (not per interface), stateless, and service-based
  rather than port-based. Recorded in §7.
- Rules can't express "except"; use an allow above a deny.
- The trace follows the current best path only (no alternative paths) and ignores `via` waypoints (remote access is
  traced to the gateway and onward separately).
- MFA has no effect yet. It becomes meaningful with credential-theft scenarios in Phase 6.
- Group-wide actions only, as decided: disabling one laptop out of 40 isn't possible.
- The policy sheet doesn't support editing an existing rule's fields in place (toggle, move and delete work; edit
  means delete and re-add).
- Each new rule from the UI gets a time-based id. That's fine for replay (the id travels in the command) but not
  human-friendly.
- Bundle size is unchanged in kind (~810 kB); Phase 8 will code-split.

### 5. Ideas for later
- "Explain this flow" in Live traffic: one click opens the trace for that app.
- Rule hit counters for allows too ("allowing 120 users"), plus a "shadowed rule" warning when a rule can never
  match because one above it catches everything.
- Policy templates ("lock down IoT", "segment guests") as one-click fixes, which pair well with Phase 6 scoring.
- A risk view: highlight devices whose role has write access to client data and no MFA.
- Saved traces as monitors: "alert me if Reception can't reach the file server".

### 6. Hand-off for Phase 5 — Device lifecycle & firmware
**Start at:** `build.md` §8 Phase 5. Add `src/engine/firmware/` with a seeded catalogue (vendor → versions with
release date, stability, advisories and EOL), install and rollback commands with downtime and outcome rolls,
hardware ageing, and a vulnerability-exposure view. Firmware strings are already on every device.

**Decisions needed from you:**
1. **Advisories:** use fictional advisories (e.g. "KSA-2026-014: remote code execution, critical") against the
   fictional vendors, rather than real CVE numbers. That keeps it vendor-neutral and safe. OK?
2. **Install outcomes:** proposed defaults per update: downtime 5–20 min (reboot); 2–8% chance the config doesn't
   migrate (device comes up degraded until rolled back); 0.5–2% chance of a brick on lean budgets (device dead until
   replaced, 4 h); rollback always possible unless bricked. Accept or adjust?
3. **When updates run:** allow "install now" and "schedule for tonight" (a maintenance window, e.g. 22:00)?
   Scheduling makes the "don't patch the firewall at 10am" lesson possible.
4. **Hardware ageing and random failures:** turn on by default (a seeded, rare chance of disk, PSU or switch
   failure, higher for old kit and lean budgets), or keep a calm mode with no random failures unless a scenario
   asks for them?

---

## Phase 5 — Device lifecycle & firmware · 2026-11-15 · ✅ complete

### 1. Summary
- **Decisions confirmed by you:** use **real CVE numbers**; accept the install-outcome defaults; offer **install
  now** and **tonight's maintenance window**; **random hardware failures on by default**. You also asked that
  device images are **never stretched or skewed** (you replaced several with your own images).
- **Images:** your 16 new device images are non-square (e.g. database 87×113, switch 116×90), and the scene had
  forced every sprite into a square. Fixed:
  - Canvas sprites now scale uniformly by their longest side (`fitSprite`), including group stacks and crowds.
  - Every `<img>` uses `object-fit: contain` globally.
  - Verified on the map, the sidebar, the Inspector and the sheets.
- **Catalogue (`engine/firmware/catalog.ts`):** 16 product lines with dated releases, stability scores and 21
  advisories. Vendors stay fictional, but every advisory carries the **real CVE id, CVSS v3 score, exploited
  flag and the real affected product** (e.g. KestrelOS ↔ Fortinet FortiOS: CVE-2022-40684, CVE-2023-27997,
  CVE-2024-21762). Lines covered: SecureLink ↔ Pulse/Ivanti, Smart Install, Arcadyan, Realtek, KRACK, QNAP HBS3,
  Hikvision ×2, HP "Printing Shellz", Rockwell Logix, EternalBlue, Zerologon (DCs only), PrintNightmare and
  Log4Shell. The UI states this and links each CVE to NVD.
- **Lifecycle (`engine/firmware/lifecycle.ts`):**
  - Installed versions (from firmware, or by budget for OS/app lines), previous version and hardware age.
  - Seeded install outcomes (5–20 min reboot; 2–8% config failure; 0.5–2% brick on lean).
  - Rollback; 4 h brick replacement on the old version; a 22:00 maintenance window with cancel.
  - Provider-managed ISP routers can't be updated by you.
  - Random failures by kind × age × budget (×52 compression) with 2–6 h repairs; `device.fail` for scenarios.
- **Simulation:**
  - Lifecycle steps every tick (events plus cache invalidation).
  - Updating, bricked and failed devices are unusable, with reasons that flow into "Why", traces and services.
  - Config-broken devices degrade every flow through them.
  - Snapshots carry `devices` and `failuresEnabled`; the hash includes lifecycle state.
- **Generator:** ships firmware by budget (lean oldest, generous latest).
- **UI:**
  - Inspector **Firmware / Software & patches** section: installed and latest version, hardware age, condition
    banner, CVE list, a version picker with dates, **Install now / Tonight 22:00 / Cancel / Roll back**.
  - **Vulnerabilities** sheet (top-bar badge with the exposed device count): grouped by CVE, sorted
    exploited → severity → CVSS, with affected device chips (click to focus), **Patch all tonight**, a
    provider-managed note, and a **risk lens** that rings devices on the map by worst severity.
  - Devices that are updating get a blue status dot.
  - **Random hardware failures** switch in the Business services panel.

### 2. Tests run
| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | ✅ 0 errors |
| Unit tests | `npm test` | ✅ **106 / 106** passed (7 files) |
| Build | `npm run build` | ✅ ~1.9 s |
| Visual: images | Sample map, Sidebar, Inspector | ✅ custom images keep their proportions (switch wide and flat, servers tall, padlock upright); `object-fit: contain` on all imgs |
| Visual: firmware section | Edge Firewall | ✅ KestrelOS 7.2.4 → latest 7.4.4, age 3 years, CVE-2023-27997 and CVE-2024-21762 (critical, exploited, Fortinet FortiOS), version picker, Install now / Tonight |
| Visual: vulnerabilities sheet | Top bar → Vulnerabilities (14) | ✅ 10 CVEs across 14 devices, sorted; Log4Shell → **Patch all tonight** → "All scheduled" plus an event for the 22:00 window; ISP router shows "Your provider must patch this" |
| Visual: risk lens | Toggle on | ✅ red/orange rings under exposed devices; 0 console errors |

New tests (13):
- Catalogue consistency (dates ordered, fix versions exist, CVE format, CVSS range).
- Every firmware string from the sample and the generator is recognised.
- Exposure maths (KestrelOS 7.2.4 vs 7.2.7 vs 7.0.6; Zerologon only on the DC).
- Lean ships more exposure than generous (generous = 0).
- An install takes 5–20 min offline with a reason, then clears the exposure.
- **4,000 seeded installs:** config failure 1.5–4.5% and brick 0.2–1.5% for a 0.93-stability release on lean
  (matching the accepted defaults).
- Bricked: no rollback, replaced after 4 h on the old version.
- Config failure degrades flows until rollback restores them.
- Refusals: provider-managed, unknown version, no firmware.
- Maintenance window runs exactly at 22:00, and cancel works.
- Manual failure: offline with the fault, back after repair.
- Random failure rate per simulated week is in range, lean > generous, and zero when switched off.
- Deterministic replay including installs, the schedule and random failures.

### 3. Issues found & resolved
| Symptom | Cause | Fix |
|---|---|---|
| Your new images looked stretched | `sprite.setSize(size)` forced a square; DOM imgs had fixed w/h | Uniform `fitSprite`; global `object-fit: contain` |
| A stray list bullet before every card in the vulnerabilities sheet | The advisory line was an `<li>` used outside a list | It's now a `<div>`; the Inspector wraps it in an `<li>` inside its `<ul>` |
| The ISP router's card said "All scheduled" | Provider-managed devices were treated as already handled | The button is hidden; "Your provider must patch this" shows instead |
| Failure-rate test timed out | 18 business-weeks simulated tick by tick | Explicit 60 s timeout |
| One `tsc` run took over 2 minutes | Machine under memory pressure (the earlier dev-server kill had the same cause) | Ran in the background and completed with 0 errors; no code change |

### 4. Known limitations / debt
- **The CVE details were written from memory** (ids, CVSS, KEV status, affected products). The well-known
  ones are very likely right, but CVE-2021-39238 (HP, CVSS 9.3), CVE-2021-28799 (QNAP, 9.8) and
  CVE-2022-27255 (Realtek, 9.8) should be **spot-checked on NVD**. A Phase 8 task could verify the catalogue
  against the NVD API at build time.
- Fixed-in versions are fictional by design, so the "real-world" line is the only claim about real products.
- Groups update as a whole (one outcome for all 40 cameras); partial group failures aren't modelled.
- Vulnerabilities don't change behaviour yet: nothing exploits them until Phase 6 incidents.
- The OS patch level is one "monthly rollup" version per line, not per-KB patches.
- The Inspector's firmware section adds height; it may want collapsible sections in Phase 8.

### 5. Ideas for later
- A change calendar: everything scheduled for tonight on one timeline, with the services it'll interrupt.
- "Test on one first": update a single device of a type before the rest (pairs with splitting groups later).
- Show a "will interrupt" preview before Install now (e.g. "Edge Firewall: everyone loses internet ~12 min").
- Vendor advisory feed in the activity log ("New advisory: CVE-…") as scenario fuel.
- Warranty and spares: generous budgets get 1 h on-site replacement instead of 2–6 h.

### 6. Hand-off for Phase 6 — Incidents, scenarios & scoring
**Start at:** `build.md` §8 Phase 6. Add `src/engine/incidents/` with seeded kill-chain state machines that use
everything built so far:
- **Initial access** via exposed CVEs (exploited ones first), default-credential cameras, phishing a role
  without MFA, or the internet-facing portal.
- **Lateral movement** constrained by firewall rules.
- **Impact:** ransomware on file/DB servers, NAS encryption (unless offsite backup), data theft.
Defenders respond with the existing tools (isolate, disable access, patch, rules). Add business impact
(cost/minute, staff idle), scenario JSON and a score.

**Decisions needed from you:**
1. **Incident mix:** proposed ten: ransomware, phishing → account takeover, exploited edge device (VPN or
   firewall CVE), DDoS on the portal, ISP outage, DNS misconfiguration, expired certificate, backup saturating
   the WAN, a failed update, and an insider copying data. Keep all, or start with a subset?
2. **Pacing:** scripted scenarios ("Monday 10:00, the VPN is exploited") *and* a free-play mode where incidents
   arrive randomly (seeded) based on exposure? Or scripted only at first?
3. **Scoring:** proposed money lost (cost per minute of downtime per service and staff idle), data exposed,
   time to contain, and spend on fixes, against a budget. Show a running score plus an after-action report?
4. **Honeypot/decoy nodes:** let the player deploy a decoy that alerts instantly when touched (making lateral
   movement visible). Include it in Phase 6?

---

## Phase 6 — Incidents, scenarios & scoring · 2026-11-15 · ✅ complete

### 1. Summary
- **Incident engine** (`src/engine/incidents/`). It is pure TS, seeded, and driven only by commands, so it
  stays inside the replay hash. There are ten incident kinds:
  - **Kill chains:** ransomware, phishing → account takeover, and an edge (VPN/firewall) exploit.
    - Initial access uses what earlier phases built: cameras on default passwords, person devices whose role
      has no MFA, and internet-facing devices with exploited CVEs.
    - Lateral movement goes only where the real routing and firewall rules allow, so segmentation genuinely
      stops attacks.
    - Impact is either encryption (devices unusable until restored) or exfiltration (red `exfil` flows on the
      map that use real bandwidth).
  - **Faults:** ISP outage, DDoS on the portal, DNS misconfiguration, expired certificate, a daytime backup
    saturating the WAN, a failed automatic update, and an insider copying data. Hardware failure was in the
    original list; it already exists as Phase 5's random failures, so the edge exploit took its slot.
- **Response:**
  - Existing tools work: isolate, power off, disable access, patch, firewall rules.
  - Incident actions: scrubbing, escalating to the ISP, reverting DNS, renewing the certificate, pausing the
    backup, resetting credentials.
  - Restore options: NAS backup, offsite, rebuild, re-image. Each has its own time and cost.
- **Detection:** incidents stay hidden until detected (by time, encryption, a touched decoy, or exfil volume).
  Undetected incidents appear in the after-action report.
- **Honeypot/decoy nodes:**
  - The generator and the sample add dormant decoys in the server room and on the first office floor.
  - Dormant decoys are invisible on the map, in the sidebar and in the simulation. Deploying one makes it
    real, and the first attacker who touches it raises an instant alarm. Insiders are caught within 30 min if a
    deployed decoy is reachable from their device.
- **Modes:**
  - Sandbox (default; unchanged behaviour).
  - Free play: calm, normal or intense, seeded, weighted by exposure.
  - Five scripted scenarios with objectives: *Monday ransomware*, *Patch day gone wrong*, *Black Friday*,
    *Edge breach*, *A bad day*.
- **Scoring:**
  - Money lost: £ per affected user-minute per app; payments and production cost the most.
  - Spend: actions, restores, decoys, firmware installs.
  - Also data stolen, time to contain, and objectives.
  - Everything is measured against a budget per employee, giving a live score and an A–F grade.
- **UI** (`src/ui/game-panels.tsx`): a Play sheet (modes, scenarios, decoy switches), a HUD in the top bar
  (score, £ lost, active incidents), an Incidents panel (cards, footholds, one-click actions), and an
  after-action report (tiles, objectives, per-incident timelines, lessons).

### 2. Tests run
| Command | Result |
|---|---|
| `npm run check` (typecheck app + engine, Vitest, `vite build`) | ✅ 126/126 tests, build OK |
| `src/engine/incidents/incidents.test.ts` (new) | ✅ 20 tests, listed below |

The 20 new incident tests:
- **Decoys:** dormant decoys are invisible and inert until deployed; a deployed decoy raises the alarm when
  touched.
- **Ransomware:** gets in via the default-password camera, spreads, encrypts and is detected. Isolating every
  foothold contains it; restoring resolves it.
- **Segmentation:** firewall rules into the server room stop the spread, including a pivot through the DMZ.
- **Phishing:** MFA for every role stops it; without MFA the attacker gets a foothold and steals data.
- **Edge exploit:** an exploited firewall CVE gives a foothold.
- **DDoS:** saturates the internet link until upstream protection starts.
- **ISP outage:** takes cloud apps down until the provider fixes it.
- **DNS misconfiguration:** breaks name lookups until reverted.
- **Expired certificate:** stops portal customers until renewed.
- **Daytime backup:** fills the internet link until paused.
- **Failed update:** leaves the device degraded until rolled back.
- **Insider:** copies data until their access is disabled.
- **Scoring:** losses accrue from downtime, and spending reduces the score.
- **Hidden incidents:** undetected incidents stay hidden from the player until the game ends.
- **Scenarios:** all five built-in scenarios are valid, run their events and finish with objectives scored.
- **Free play:** raises incidents over a working day.
- **Replay:** a whole game replays deterministically from its command log.

Earlier suites were updated: the sample now has 26 nodes and 25 links (two decoys), and the routing tests
(lanes, crossing gaps, no cable under a device) still pass with the decoy cables.

**Visual checks** (Chrome, sample business):
- The Play sheet renders the modes, the five scenario cards and the decoy switches.
- "Patch day gone wrong" at 16× produced both scripted incidents: DNS misconfiguration and a failed
  automatic update. Both were detected and shown with timelines.
- "Revert the DNS change (10 min · £0)" was offered, the HUD read *764 · £1,098 lost · 2 active*, and the
  activity feed showed the "DNS broken" reasons on failing flows.
- Dormant decoys are absent from the map and the sidebar.

### 3. Issues found & resolved
| Symptom | Cause | Fix |
|---|---|---|
| The segmentation test failed: the attacker still reached the server room with office→server blocked | Realistic: it pivoted office → DMZ portal → server room | The test now blocks edge→server too and asserts no foothold in `z-server` |
| `l-ap-junior` crossed the new decoy cable inside a corner arc, so the gap test failed | The office decoy at (18,14) forced an awkward route | Moved `decoy-office` to (14,14) |
| Timing tests flaky under parallel Vitest load | CPU contention, not regressions | Routing stress budget raised to 3 s; firmware outcome and replay tests given 60 s timeouts; the engine stress test takes the best of 3 batches (still < 10 ms/tick) |
| Dormant decoys would have shown as ghost icons and cables | The renderer drew every node and link | Scene hides decoy roots, labels and links; decoy state is part of the link-cache key; the sidebar filters them out |
| Shell scripts mangled by quoting (heredocs and template literals) | Git Bash on Windows | Multi-line edits use scratchpad `.cjs` scripts or the Edit tool |

### 4. Known limitations / debt
- Attackers don't adapt: no persistence, no re-entry after eviction, no choosing targets by data value.
- An attack holds a whole group foothold ("Sales · 24 laptops"), not one laptop in it, so isolating the group
  is the only per-device response (groups are still group-wide by decision).
- Cost per user-minute is a flat table per app; it ignores time of day beyond the demand curve, and there is
  no SLA or regulatory penalty.
- Detection is rule-based (timers, decoys, volume); there is no SIEM, log source or false positive.
- The DDoS hits only the customer portal; no volumetric attack on the VPN.
- Score weights are first guesses and will need tuning by playing.
- Scenarios are built in; loading scenario JSON from a file waits for Phase 7 import/export.
- The after-action report sheet typechecks and builds, and the data behind it is unit-tested, but I didn't
  open it in the browser this phase. Only the Play sheet, HUD and Incidents panel were checked visually.
- The real CVE details in the firmware catalogue (Phase 5) should still be spot-checked against NVD.

### 5. Ideas for later
- Detection tools as purchases: an EDR agent (faster detection on laptops), a SIEM (raises detection odds),
  egress filtering (caps exfil).
- Backup hygiene as a choice: immutable or offsite backups decide whether ransomware can encrypt the NAS.
- A "tabletop" mode: pause on each detection and ask the player what they'd do, then grade it.
- Attackers with personalities (opportunist, targeted, insider) that pick different paths.
- Show the attacker's path on the map after the game as an animated replay (pairs with Phase 7's scrubber).
- Scenario editor: drag events onto a timeline and save them as JSON.

### 6. Hand-off for Phase 7 — Time travel & persistence
**Start at:** `build.md` §8 Phase 7. The building blocks exist: every change is a validated command, the
command log replays to an identical hash, and incidents are part of that hash.
- **Undo/redo:** replay the log up to N−1 from the initial topology and seed, with snapshots every few
  minutes so replay is fast.
- **Timeline scrubber:** a track under the canvas with incident markers; drag to rewind and view the past
  read-only.
- **Save/load:** IndexedDB (Dexie) storing topology + seed + command log; export and import JSON
  (including scenario JSON).
- **Share codes:** a compressed seed + command log; **report export:** after-action report to PDF or Markdown.

**Decisions needed from you:**
1. **Undo scope:** undo every player command (including incident actions mid-game, which would allow
   "cheating" a score), or only outside a game, with games treated as committed?
2. **Scrubber:** rewind and *branch* (play on from an earlier moment, discarding the future), or rewind to
   watch only?
3. **Saves:** autosave plus named slots, or named saves only? Keep how many autosaves?
4. **Report export:** PDF, Markdown, or both? Share codes as a URL (`?s=…`) or a copyable text code?

---

## Phase 7 — Undo, saves & sharing · 2026-11-16 · ✅ complete

Decisions applied: each game is final once played; no rewind; autosave each simulated day plus named slots, with
a notice; report export as `.md`; share codes as a code you copy.

### 1. Summary
- **Undo/redo** (↶ ↷ in the top bar, ⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z or Ctrl+Y):
  - Covers power, isolation, links, firewall rules (add, edit, move, remove), disable access, roles, per-app
    access, MFA, decoys, the failures switch, and tonight's scheduled installs.
  - It reverses the change *now* and never rewinds the clock. The reversing command is logged, so replays
    stay exact.
  - Tooltips name the change ("Undo: Reception PC isolated from the network").
  - **Games are final:** starting a game clears the history, and undo stays off until the game ends. The
    tooltip says why.
- **Saves** (new **Saves** button, plus **Open a save…** in the wizard):
  - Named saves: optional name, defaulting to "business · day time".
  - **Autosave at the start of every simulated day**, with a toast: "✓ Autosaved · Harbour & Finch
    Accountants · Tue 00:00". The newest 7 are kept.
  - Load (with a "Replace the current session?" confirmation), Copy code, Delete.
- **Saves restore the exact state** instead of replaying the log, because replaying is too slow (measured:
  about 1 s per simulated day for the sample, 2 s for a mid-size business, 10 s for an enterprise).
  - Every save carries a snapshot hash. Loading recomputes it and refuses anything that doesn't match.
  - The command log is still inside each save.
- **Share codes:** "Copy share code" copies `HONEYPOT1-…` to the clipboard and also shows it in a box to copy
  by hand. "Open a share code" loads one, even if it was wrapped across lines.
  - Generated businesses travel as their wizard spec, so codes stay short: about 5k characters for the
    sample, about 21k for an enterprise.
- **After-action report → `.md`:** an **Export .md** button on the report downloads
  `<business>-after-action-report-<date>.md`. It contains the summary table, objectives, and every incident
  (including undetected ones) with times, cost, footholds, timeline and lessons.

### 2. Tests run
| Command | Result |
|---|---|
| `npm run check` (typecheck app + engine, Vitest, `vite build`) | ✅ 145/145 tests (19 new), build OK |
| `src/engine/save/save.test.ts` (new) | ✅ 7 |
| `src/engine/sim/history.test.ts` (new) | ✅ 6 |
| `src/engine/incidents/report.test.ts` (new) | ✅ 2 |
| `src/persist/share.test.ts` (new) | ✅ 4 |

What the new tests cover:
- **Saves:**
  - A mid-game save, with ransomware and DDoS in flight, a scheduled install and a deployed decoy, restores
    to the same hash and state.
  - Run on for 13 more simulated hours (through the 22:00 window), the restored copy and the original stay
    identical.
  - The command log is kept.
  - Tampered saves are rejected (erasing losses breaks the hash), as are saves for a different business.
  - A generated business is stored as its spec and regenerates exactly.
  - Save descriptions are correct.
- **Undo:**
  - Each of 15 different change types undoes back to the starting settings and redoes forward again.
  - Undo never moves the clock.
  - A running install isn't undoable, but earlier changes still are.
  - A new change clears redo.
  - Games are final: history is cleared when a game starts, undo is refused while it runs, and history
    resumes after it ends.
  - Undo and redo are logged, so `Simulation.replay` matches the hash.
- **Report:** a finished scenario exports its title, score, objectives, every incident and every timeline
  line. Undetected incidents are included.
- **Share codes:**
  - Round trip with line wrapping reproduces the same hash.
  - Size limits hold.
  - Bad and truncated codes give readable errors.
  - Autosave pruning keeps the newest 7 and never prunes named saves.

**Visual checks** (Chrome, sample business):
- **Undo:** isolating Reception PC gave "Undo: Reception PC isolated from the network". Ctrl+Z reconnected
  it and Redo was offered.
- **Saves sheet:** it renders. Save gave "✓ Saved …".
- **Share code:** Copy share code gave "✓ Share code copied (5,088 characters)". Pasting that code and
  pressing Open gave "✓ Opened Harbour & Finch Accountants from a share code".
- **Autosave:** at 16×, the toast "✓ Autosaved · Harbour & Finch Accountants · Tue 00:00" appeared exactly at
  midnight (55 s of real time). The autosave was listed as "Day 2", and loading it restored the map at TUE
  00:00 with all services healthy.
- **Games are final:** during the *Monday morning ransomware* scenario the undo tooltip read "Games are
  final: undo is off until the game ends".
- **Report:** after the scenario ended, the report showed "Final results" and Export .md produced
  `harbour-finch-accountants-after-action-report-2026-11-16.md` with a confirmation toast. This also covers
  Phase 6's open item: the report sheet is now checked visually.
- No console errors or warnings.

### 3. Issues found & resolved
| Symptom | Cause | Fix |
|---|---|---|
| Replay-based loading would take about 50 s for a five-day enterprise save | Every tick evaluates every flow | Saves store the full state instead (all randomness is stateless, so that's plain data), and a hash check proves exactness |
| A save's map could receive snapshots before the UI switched to it | Comlink delivers worker callbacks before the method's return value | Two-step load: `prepareSave` verifies and returns the topology, the UI swaps the map, then `activateSave` starts the session |
| Autosaves could land a few minutes after midnight | The worker advances in batches of up to 64 ticks | Batches stop exactly at midnight |
| The undo round-trip test "failed" on a rule move | The move to #4 was clamped to the rule's own position (only two rules), so it was a no-op and correctly not recorded | Test moves to #1 |
| Undoing a per-app access change left `access: {files: "read"}` instead of no entry | The inverse stores the effective value explicitly | Behaviourally identical (the default is read); the test compares effective access |
| A named save's default name showed the time the sheet *opened* (08:50) for a save taken at 09:05 | The name was prefilled on open | The name is now blank with a placeholder, and the default is stamped at save time |
| The "Phase 7" pill wrapped onto two lines | Top bar crowded by Saves and undo/redo | The pill shows only at ≥ 1800 px, without wrapping |

### 4. Known limitations / debt
- **Loading an earlier save during a game works**, so a player could reload to escape a bad decision.
  Undo is locked, but saves aren't (see decision 1 below).
- Undo history isn't saved; loading a save starts with empty history.
- A save that no longer reproduces (e.g. after a future engine change) is refused rather than migrated. Save
  versioning and migrations come only once there is a v2 format.
- Share codes for big businesses (about 21k characters) are fine for the clipboard but too long for some
  chat apps' message limits.
- IndexedDB itself has no automated test (no browser in Vitest). It was checked by hand in Chrome; the
  pruning rule is unit-tested.

### 5. Ideas for later
- "Ironman" option: one autosave slot overwritten during a game, so games stay final even across loads.
- Export and import a save as a `.json` file (same format as share codes, uncompressed).
- Show the attacker's path from the report on the map.
- Compare two reports (before and after hardening) side by side.
- Undo history panel listing the last few changes.

### 6. Hand-off for Phase 8 — Polish, accessibility & performance
**Start at:** `build.md` §8 Phase 8. Proposed scope:
- An accessible **table view** mirroring the map (devices, status, links), plus keyboard navigation across
  the map and panels.
- **Reduced motion** (no particles, no animated camera) honouring the OS setting.
- **Dark mode.**
- A **guided tutorial scenario.**
- A **performance pass:** enterprise snapshot size, worker → UI payload, and fps budget re-checked with
  incidents running.

**Decisions needed from you:**
1. **Saves during games:** keep loading free (players can reload an earlier save mid-game), or add an
   "ironman" rule so a game in progress can only be continued, never reloaded from earlier?
2. **Dark mode:** follow the system setting automatically, add a manual toggle, or both?
3. **Tutorial:** a short guided scenario (about 10 steps: trace, isolate, firewall rule, patch, a small
   incident), or tooltips on first use only?
4. **Accessibility target:** aim for WCAG 2.2 AA throughout (the table view, focus order, contrast in both
   themes), or AA for panels only with the map as a visual extra?

---

## Phase 8 — Polish, accessibility & performance · 2026-11-16 · ✅ complete

Decisions applied: saves stay loadable during games; dark mode follows the system *and* has a toggle; the tour is
offered after creating a business (with "Don't ask again"), can be re-run from the New business menu, and ends by
urging Play; WCAG 2.2 AA everywhere.

### 1. Summary
- **Dark mode.**
  - Every colour is now a semantic token with light and dark values (`styles.css`). The theme
    follows the system, or the top-bar toggle (◐ System → ☀ Light → ☾ Dark), which is remembered
    per browser.
  - A script migrated about 210 hard-coded colours across the UI to tokens.
  - The canvas has its own dark palette: zone plates tinted from each zone's hue, dark label pills,
    stronger ground shadows. It rebuilds when the theme changes.
- **WCAG 2.2 AA.**
  - **Contrast:** secondary text darkened (the old grey `#86868B` was 3.6:1). Light status dots
    darkened to reach 3:1 as graphics. Separate `*-ink` text colours for status badges in both themes.
  - **Keyboard:**
    - A visible focus ring on every control.
    - All four dialog types move focus in, trap Tab, and return focus on close.
    - Hidden side panels are `inert`, so focus can't land in off-screen content.
    - Space only pauses when it isn't operating a focused control.
  - **Screen readers:**
    - Named regions (Devices, Device details, Business services, Activity).
    - The map is described as an image that points to its text equivalents.
    - A polite live region announces new warnings and failures (batched).
    - Labels added to the device search and business name.
    - The Vulnerabilities badge reads "14 devices exposed".
    - A heading-level fix in Policy.
  - **Table view** (new **Table** button): the whole network as accessible tables.
    - Devices: name, type, zone, address, live status, problems, firmware and CVE count. Each name
      opens the inspector.
    - Connections: type, capacity, state, load.
  - **Skip links:** to the device list, and to open the table.
  - **Reduced motion:** the OS setting removes camera glides, pulses, hover lifts, CSS transitions and
    moving traffic dots.
- **Guided tour** (`tour.tsx`):
  - After **Create network** or **Use the sample business**, a "Take a quick tour?" card appears with
    *Start tour*, *Not now* and a **Don't ask again** checkbox.
  - The New business menu has **Take the tour** and the same checkbox.
  - The ten steps spotlight the real UI: welcome, devices (advances by itself when you pick one),
    acting on a device and undo, business services, Trace, Policy, Vulnerabilities, time and undo,
    Saves, and finally **"Now defend it"**, which highlights Play and offers **▶ Play now** (opens
    the Play sheet).
  - The tour is a labelled, non-modal dialog that takes focus each step; Escape ends it.
- **Performance pass.**
  - An enterprise snapshot was 434 KB, and 80% of it was flows. The new snapshot transport (`worker/wire.ts`):
    - sends flow identities only when the set of flows changes;
    - sends paths only when they change;
    - sends the per-flow numbers as typed arrays.
  - Steady pushes are now 113 KB, and the UI rebuilds identical snapshots (tested).
  - Fixed the simulation rebuilding every path on tick 1, and stopped the undo/redo buttons
    re-rendering on every snapshot.

### 2. Tests run
| Command | Result |
|---|---|
| `npm run check` (typecheck app + engine, Vitest, `vite build`) | ✅ 158/158 tests (13 new), build OK |
| `src/ui/contrast.test.ts` (new) | ✅ 10 tests, listed below |
| `src/worker/wire.test.ts` (new) | ✅ 3 tests, listed below |

What the new tests cover:
- **`contrast.test.ts`**, for each theme:
  - all text tokens are ≥ 4.5:1 on every surface;
  - status text is ≥ 4.5:1 on its own 10–20% tint;
  - white text on accent, hover and danger is ≥ 4.5:1;
  - dots and fills are ≥ 3:1.
  - The system-dark and forced-dark CSS blocks are identical.
  - No component uses raw white/black or hex colours.
- **`wire.test.ts`:**
  - Exact round trip through `structuredClone`, across commands and an incident that adds a flow.
  - Static parts and paths are sent once, and re-sent only on change.
  - The enterprise steady push is under a third of a full snapshot (113 KB vs 434 KB).

**Browser checks** (Chrome):
- **Lighthouse accessibility:** 100 in light, 100 in dark, and 100 in dark with the Policy dialog
  open. Fixed on the way: a label/name mismatch on the Vulnerabilities button, a skip link pointing
  at an element that only exists once opened, and a skipped heading level.
- **Tour:** the offer appeared after "Use the sample business" with focus on *Start tour*. Started
  from **New business → Take the tour**, all 10 steps ran.
  - Every card stayed in view.
  - Each target was ringed.
  - Focus moved to *Next* on each step.
  - Picking Reception PC on step 2 advanced the tour.
  - The last step offered *Finish / Back / ▶ Play now*.
  - *Play now* opened the Play sheet with focus inside it.
- **Theme:** the toggle went System → Light → Dark. `data-theme` and the saved preference updated,
  and the map, panels and table all switched (screenshots reviewed).
- **Reduced motion:** with Chrome emulating `prefers-reduced-motion: reduce`, the scene reported
  reduced motion and hid the traffic dots.
- **Performance** (enterprise, 800 staff, 5 sites, 219 nodes and 2,250 particles, intense free play
  at 16×):
  - Production build: **57 fps** over 10 s, one 51 ms long task.
  - The dev server reads lower (about 44–49 fps) because development React does much more work per
    render.
  - Paused: 60 fps.
- No console errors or warnings.

### 3. Issues found & resolved
| Symptom | Cause | Fix |
|---|---|---|
| "Start tour" did nothing | `tour.go()` set the step but left the offer showing, and the offer takes priority | `go()` clears the offer |
| Secondary text failed AA (3.6:1); light status dots failed 3:1 | Apple system colours are tuned for look, not contrast | AA-checked tokens per theme, guarded by `contrast.test.ts` |
| Contrast test found `ink-3` on `surface-2` at 4.46 and `accent-ink` on its tint at 4.48 | Values chosen by eye | Darkened to `#68686D` and `#0059B3` |
| Vitest returned an empty string for `styles.css?raw` | Vitest stubs CSS imports | The test reads the file from disk; a tiny ambient type declares `node:fs` (no `@types/node`) |
| Keyboard focus could land in off-screen panels | Panels were hidden by translating them away with `aria-hidden` only | `inert` when hidden |
| Space paused the clock *and* pressed the focused button | The key handler only ignored text inputs | It ignores buttons, links, switches and form fields |
| Traffic dots still jumped with reduced motion on | Streams are rebuilt with each snapshot, so frozen dots still change position | Dots are hidden under reduced motion |
| Enterprise at 16× ran at 34–49 fps on the dev server | 442 KB snapshots copied 9×/s (~15 ms each), 78% of them flows | `wire.ts` sends static parts once and numbers as typed arrays |
| Every flow path was rebuilt on tick 1 | `effectKey` started as `""` | Initialised in the constructor |
| Paths looked "changed" every tick | Idle flows report `path: null`, so flickering flows resent their path | Paths are implied by status; only flows carrying traffic compare paths |
| Undo/redo buttons re-rendered on every snapshot | The selector returned a new object each time | Separate primitive selectors |

### 4. Known limitations / debt
- **Automated checks aren't a full AA audit.** Lighthouse/axe and the contrast test catch a lot, but I
  haven't tested with real screen readers (NVDA, VoiceOver), at 200–400% zoom (reflow), or in Windows
  high-contrast mode. A manual pass is the honest next step before claiming conformance.
- The map itself is pointer-only. Keyboard and screen-reader users work through the device list,
  inspector and table view (equivalent, but not the same experience).
- The tour explains each tool but doesn't check that the player did the suggested action (except
  picking a device).
- The layout targets desktop. Below about 1280 px wide the top bar crowds.
- The dev server's fps is lower than production. Performance numbers in this diary are from
  `vite preview`.

### 5. Ideas for later
- An "Accessibility" settings panel: larger text, high-contrast theme, reduce motion in-app (not just
  from the OS), and keyboard shortcuts listed.
- Keyboard navigation of the map itself: arrow keys move between neighbouring devices, Enter selects.
- A tour per feature ("Show me Trace") from a Help menu, and a second tour for the first game.
- Live-update the table only while visible, and virtualise it for very large businesses.
- Push less often while paused or when the tab is hidden (saves battery).

### 6. Hand-off: after the eight planned phases
All eight phases in `build.md` are complete. Next steps are your call. Options, roughly in order of value:
1. **Manual accessibility pass:** screen readers, zoom/reflow and high contrast, then fix what they find.
2. **Content:** more scenarios, industries, products/CVEs and incident variants; a scenario editor.
3. **Depth:** per-device state inside groups, attacker personalities, detection tools you can buy (EDR, SIEM).
4. **Sharing beyond one browser:** export/import save files, a hosted version, multiplayer red vs blue.

**Decisions needed from you:**
1. Which direction next: accessibility audit, content, simulation depth, or sharing?
2. The project folder isn't a git repository yet. Should I set one up and commit the work, as one
   commit or one per phase?
3. Should the app support smaller screens (tablet width), or stay desktop-only?
4. Any CVE spot-check findings from the Phase 5 catalogue to correct?

---

## Phase 9 — Content & tablets · 2026-11-17 · ✅ complete

Decisions applied (answering the Phase 8 hand-off): content first, as new incident types and scenarios; two new
industries, Education and Logistics; every CVE checked against public sources; tablet support in landscape and
portrait. The project is now a git repository with one commit per phase (`M1` … `M9`), pushed to
`github.com/adamterrelonge/HoneyPot`.

### 1. Summary
- **Four new incident types** (14 in total):
  - **Compromised software update** (supply chain).
    - Backdoors land on two servers and a desktop group at once.
    - They survive a password reset. "Remove the backdoored update" (2 h, £3k) evicts them.
    - Exfiltration is low and slow (2 Mbps from one server), and detection comes at 8 h.
  - **Credential stuffing on the VPN.**
    - A login storm is detected at 15 min.
    - A reused password works after 30–75 min if any role lacks MFA.
    - Turning on MFA, blocking the attacking IPs or taking the VPN offline in time stops it.
    - Once in, a password reset evicts the attacker, even though the VPN has exploitable CVEs (the foothold
      came from a login, not an exploit).
  - **Ransomware on the production line** (OT).
    - Spreads from the office to PLCs and clinical imaging devices over their own services (production,
      imaging).
    - Weighted 20× towards OT, and waits up to 6 extra moves to reach it before encrypting.
    - Restores: controller programs from the engineering backup (3 h, £3k), or a vendor re-image for
      clinical devices (4 h, £2.5k).
    - Blocked on businesses with no OT devices to target.
  - **Invoice fraud** (business email compromise).
    - An urgent bank-change request to Finance for £5k + £150 per employee, with a 90–150 min deadline.
    - "Phone the supplier" (15 min) stops it. Otherwise the amount is lost.
    - If the finance role has no MFA, the mailbox itself was taken over, and a password reset is also needed.
- **Scenarios:** 12 in total, with an optional `industries` filter.
  - The Play sheet shows only scenarios that fit the business, and the engine refuses a mismatch.
  - New: The poisoned update, Dawn raid on the VPN, Payroll Friday, Line down (manufacturing), Clinic under
    siege (healthcare), Exam season (education), Peak dispatch (logistics).
- **Industries** (6 in total):
  - **Education:**
    - Departments: Teaching, Leadership, Finance & Admin, Pastoral & SEN, Support Staff.
    - Student Records (MIS, `student-data`) and a Parent Portal.
    - A Student Wi-Fi zone with 3 devices per staff member, on guest rules (internet only).
    - Branch sites are called "Campus".
  - **Logistics:**
    - A Warehouse Floor (the factory zone kind) at HQ and in every depot.
    - Handheld scanners (40% of site staff), label printers and dock cameras.
    - Its app is "Warehouse scanning" to the WMS, costing £0.90 per user-minute.
    - Branch sites are called "Depot".
  - The original four industries generate byte-for-byte identically, so old saves and share codes still load.
- **CVE check:** all 19 advisories checked against the live NVD API and the CISA KEV feed.
  - Four CVSS scores corrected: CVE-2017-0144 8.1→8.8, CVE-2017-7921 10→9.8, CVE-2021-39238 9.3→9.8,
    CVE-2022-1161 10→9.8.
  - Every KEV flag and product attribution matched.
- **Tablets** (`state/viewport.ts`: compact < 1280 px, narrow < 900 px):
  - Compact: the device list and services panel become drawers (top-bar "Devices" and "Services"), and the
    secondary actions move into a "More" disclosure.
  - Narrow (portrait): picking a device closes the drawer, and panels are capped to the screen width.
  - The top bar wraps when it must, and panels follow its measured height (`--top`).
  - Map gestures: one-finger pan, two-finger pinch-zoom plus pan.
  - Coarse pointers get 36 px targets, and the hints say "tap" and "pinch".
- **Fix:** once a game ends, attackers stop, so the after-action report stays final.
- **README.md** added for the public repository.

### 2. Tests run
| Command | Result |
|---|---|
| `npm run check` (typecheck app + engine, Vitest, `vite build`) | ✅ 186/186 tests in 16 files (28 new since Phase 8), build OK |
| `src/engine/incidents/incidents-p9.test.ts` (new) | ✅ 20 tests, listed below |
| `src/engine/firmware/cve.test.ts` (new) | ✅ 2 tests, listed below |
| `npm ci` on a clean checkout | ❌ then ✅ after the lockfile was synced (see §3) |

What the new tests cover:
- **Compromised update:** lands on several machines at once and survives a password reset; removing the
  update evicts the attacker; stays quiet for hours unless something gives it away.
- **Credential stuffing:** login storm then break-in when MFA is off; MFA in time shuts it out; blocking the
  IPs in time ends it; a password reset evicts the attacker despite the VPN's CVEs.
- **OT ransomware:** needs controllers or clinical devices; on a flat network it reaches the controllers and
  stops production; segmenting every path to the factory floor keeps it off them.
- **Invoice fraud:** the payment is lost if nobody checks before the deadline; phoning the supplier stops it;
  a taken-over mailbox also needs a password reset.
- **Scenarios:** there are 12, all valid, and industry ones appear only for their industry; a mismatch is
  refused; every scenario plays to the end on a business it is written for.
- **After a game:** the report is final, and stolen data and losses stop growing.
- **Industries:** education student Wi-Fi is busy and reaches only the internet; logistics scanners keep the
  WMS busy at HQ and every depot; all six industries are offered.
- **CVE facts:** every advisory matches the checked NVD score and KEV status; severity labels follow the
  CVSS v3 bands.

Not re-recorded in this entry:
- The Lighthouse accessibility score at tablet portrait size (a "Done when" criterion), and the hashing of
  144 spec combinations against the Phase 8 commit. The figures above come from the build plan. Re-run and
  record them before treating those criteria as evidenced here.

Build output: the main `index` chunk is 923 kB (264 kB gzipped). Vite warns that it is over 500 kB.

### 3. Issues found & resolved
| Symptom | Cause | Fix |
|---|---|---|
| Exfiltration and payouts kept growing after "Final results" | Attackers kept running after the game ended | Incidents stop when the game ends |
| CVSS scores for 4 CVEs disagreed with NVD | The Phase 5 values were wrong | Corrected from the live NVD API; pinned in `cve.test.ts` |
| `npm ci` failed on a clean clone: `Missing: @emnapi/core@2.0.0-beta.2 from lock file` | `package-lock.json` out of sync with `package.json` | `npm install` regenerated the lockfile; commit it with this entry |
| `bash.exe.stackdump` was committed in `M9` | MSYS crash dump in the project folder; not in `.gitignore` | Remove it and add `*.stackdump` to `.gitignore` |

### 4. Known limitations / debt
- The manual accessibility pass (screen readers, 200–400% zoom, Windows high contrast) from Phase 8 is still
  outstanding.
- Phones are not supported. Below 900 px wide, only tablet portrait has been designed for.
- The map is still pointer- and touch-only; keyboard users use the device list, inspector and table view.
- The main bundle is over Vite's 500 kB warning limit.
- No licence has been chosen, so the public repository is "all rights reserved".

### 5. Ideas for later
- Code-split the panels and the Play/Saves sheets with dynamic `import()` to shrink the main chunk.
- A CI workflow running `npm ci && npm run check` on every push, so lockfile drift is caught at once.
- A scenario editor, now that scenarios have an `industries` filter.
- Detection tools you can buy (EDR, SIEM) that shorten the supply-chain incident's 8 h detection time.

### 6. Hand-off
All nine phases in `build.md` are complete.

**Decisions needed from you:**
1. Which licence should the public repository use (for example MIT), or should it stay all rights reserved?
2. Should a GitHub Actions CI workflow be added?
3. Which direction next: the manual accessibility audit, simulation depth, or sharing beyond one browser?

---

## Phase 10 — Release readiness & extensions · 2026-11-20 · ✅ complete

Decisions applied (answering the Phase 9 hand-off): MIT licence; a GitHub Actions CI workflow; all
outstanding debt cleared where it can be done without a human tester; then drafts of a Rust/WebAssembly
engine port and an optional Python backend.

### 1. Summary
- **Logo:** the custom bear logo (602×314, transparent) replaced the square emoji. `src/ui/logo.tsx` draws it
  as a CSS mask filled with the text colour, so it keeps its aspect ratio at any height and turns white in
  dark mode. Used in the top bar (`h-7`), tour card (`h-8`) and wizard (`h-6` on phones, `h-10` from `sm`).
  Square favicons (32/180/192/512 px) put the logo on a honey-yellow rounded tile; `index.html` links them
  with an Apple touch icon and `theme-color`. The README uses the 512 px icon.
- **Industry artwork:** custom images for all six industries, including the two that were missing
  (Education, Logistics), plus a new ISP image. All load from their own files (no HQ fallback).
- **Licence:** MIT (`LICENSE`, `package.json`); README credits separate custom artwork from Fluent Emoji.
- **CI:** `.github/workflows/ci.yml` with three jobs: web, Rust engine and API.
- **Generator golden hashes:** `src/engine/gen/golden.test.ts` + `golden-144.json`, recorded from the Phase 8
  commit `eaffe79` in a temporary worktree. This re-records, and makes permanent, the Phase 9 criterion.
- **Bundle split:** `react` (219 kB), `vendor` (164 kB), `pixi` (669 kB) and app (204 kB) chunks instead of
  one 923 kB chunk.
- **Phones and high zoom:** layout fixes listed in build.md Phase 10; `public/robots.txt` added.
- **Rust → WebAssembly draft:** `engine-rs/` ports firewall policy evaluation, with a JSON batch interface and
  a resident interface (topology loaded once, integer ids, typed arrays). `src/wasm/policy-wasm.ts` loads it;
  `npm run build:wasm` builds it. Not used by the simulation yet.
- **FastAPI draft:** `api/` with share links and scenario leaderboards, Dockerfile and its own README.

### 2. Tests run
| Check | How | Result |
|---|---|---|
| Clean install | `npm ci` | ✅ lockfile in sync, 0 vulnerabilities |
| Typecheck | `npm run typecheck` (app + engine configs) | ✅ |
| Unit tests | `npm test` | ✅ **195 passed, 18 files** (was 186 / 16) |
| Golden hashes | 144 specs vs Phase 8 commit `eaffe79` | ✅ all identical |
| WASM parity | 2,000 random flows × 6 industries, JSON and resident interfaces | ✅ identical decisions and reasons |
| Rust | `cargo fmt --check`, `cargo clippy --all-targets -D warnings`, `cargo test` | ✅ 8 passed |
| WASM benchmark | 100k decisions, enterprise retail business, Node 24 | TS 15.4 ms / resident 2.8 ms (7 rules); TS 102 ms / resident 12.2 ms (60 rules); JSON interface 66 ms (slower than TS) |
| Build | `npm run build` | ✅ no chunk-size warning |
| Lighthouse (snapshot) | 390×844 phone and 768×1024 tablet portrait | ✅ Accessibility 100, Best practices 100, SEO 100 (83 before `robots.txt`) |
| Overflow audit | Script over header, drawers, sheets and inspector at 320×568 | ✅ none, except data tables, which scroll inside their panel (allowed by WCAG 1.4.10) |
| Visual checks | Chrome DevTools: logo at 390/1440/1920 px, light and dark; wizard at 320/390/640×450; Education and Logistics businesses generated and healthy | ✅ 0 console errors |
| API | — | ⚠️ **not run locally**: Python isn't installed on the build machine. First run is the CI `api` job |

### 3. Issues found & resolved
| Symptom | Cause | Fix |
|---|---|---|
| README never reached GitHub; new files didn't show in `git status` | `.gitignore` line 5 (`*.stackdump`) was appended as UTF-16; git read it as `*` | Rewrote `.gitignore` as ASCII |
| Logo squashed into a square and invisible in dark mode | Wide black PNG in `h-6 w-6` boxes | `Logo` component (CSS mask, aspect ratio, text colour) |
| Wizard title squeezed to two lines on phones | 77 px-wide logo beside the title | Smaller logo below `sm` |
| App failed to start: `Cannot read properties of undefined (reading 'add')` | Splitting PixiJS by size reordered its side-effect imports | One `pixi` chunk; warning limit 700 kB, documented in `vite.config.ts` |
| At 200% zoom the wizard form had ~130 px between a fixed header and footer | Only the middle section scrolled | Whole card scrolls on screens under 600 px tall |
| At 320 px the speed buttons, "Surprise me", industry cards and "Back to map" ran off-screen | Rows that didn't wrap; input with an intrinsic minimum width | `flex-wrap`, `min-w-0`, one-column grid below 400 px |
| At 320 px the inspector was ~160 px tall, with the activity feed showing through | Panels stop 168 px above the bottom for the feed | Below 640 px panels run to the bottom; feed and zoom hide while one is open |
| `golden.test.ts` failed typecheck (`node:url`, `process`) | App is typed without `@types/node` | Declared the few Node APIs in `src/test-env.d.ts`, as before |
| First WASM version slower than TypeScript | JSON serialisation dominated the cost | Resident interface with interned ids and typed arrays |
| `npm ci` failed with `EPERM` on `lightningcss.win32-x64-msvc.node` | A `vite preview` server from the visual checks held the file open | Stopped the server, re-ran |

### 4. Known limitations / debt
- Screen-reader (NVDA, VoiceOver) and Windows high-contrast checks still need a human tester. Zoom and
  reflow are now covered.
- The API has never been executed: its tests, lint and types first run in CI. Expect small fixes.
- The Rust engine isn't wired into the simulation; only policy evaluation is ported.
- API scores are trusted as submitted (seed and state hash are stored for later verification).
- On phones the map is usable but small; the device list is the practical way in.
- The licence names "Adam Terrelonge" as copyright holder; change it if a different name should appear.

### 5. Ideas for later
- Wire the resident WASM policy into the worker behind a feature flag, then port flow routing.
- Verify leaderboard runs on the server by replaying the command log (Node or the Rust engine).
- Frontend `VITE_API_URL` integration: "Copy link" in Saves and a leaderboard in the Play sheet.
- Deploy the static site (Cloudflare Pages or GitHub Pages) and link a live demo from the README.
- Map incidents to MITRE ATT&CK technique ids in the after-action report.

### 6. Hand-off
**Decisions needed from you:**
1. Push and check that all three CI jobs pass, especially `api`, which has never run.
2. Where to host the live demo, and whether to deploy the API with it.
3. Next priority: wiring WASM into the simulation, frontend integration of the API, or the manual screen-reader audit.

---

## Phase 11 — Onboarding & local progress · 2026-11-21 · ✅ complete

Decisions applied (from the workflow doc): the hosted API is not deployed; the game stays free and
offline-first; leaderboards give way to local progress; onboarding first, then realism (Phases 12–14).

### 1. Summary
- **Onboarding flow** in one card (`src/ui/onboarding.tsx`), with the goal → plan logic kept pure in
  `src/state/onboarding.ts`. Native radio cards (arrow keys, screen readers), focus moves to each step's
  heading, the step count is announced, motion respects reduced-motion.
- **Tour folded in:** `tour.afterBusinessCreated()` starts or skips the tour from the Ready screen's choice;
  the separate pop-up appears only for visitors who skipped onboarding.
- **Personal bests** (`src/state/progress.ts`) on the Play sheet's scenario cards, a recommended badge and
  the suggested intensity.
- **Pages deploy:** `.github/workflows/pages.yml` publishes the static site after CI passes; `public/`
  paths resolve against the deploy base through `asset()`.
- **Online UI removed from master** (share links, leaderboards); kept on the `online-features` branch.
  `api/` stays as a tested draft and the hosted API is not deployed.

### 2. Tests run
| Check | How | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | ✅ |
| Unit tests | `npx vitest run` | ✅ **205 passed, 19 files** (7 WASM tests skipped without a local WASM build) |
| New tests | `state/onboarding.test.ts`: every topic, threat and the review scenario exists and fits the sample business; every goal × familiarity has a plan; intensity and tour defaults; personal-best merging | ✅ 6 passed |
| Build | `npm run build` | ✅ |
| Browser check | Onboarding paths, Skip, Esc, returning visitor, tour hand-off, Play sheet | ✅ tried by the project owner |

### 3. Issues found & resolved
| Symptom | Cause | Fix |
|---|---|---|
| Four engine tests failed in a full run, passed alone | 5 s default timeout while a preview server and a CI watcher were running | Not a regression; full runs use `--testTimeout=20000` on a busy machine |
| Command-error toast hidden under the wizard and other sheets | No z-index on `ErrorToast` | Raised to `z-50`, like the notice toast |

### 4. Known limitations / debt
- Learn mode has no lessons yet: a topic only picks the scenario (lessons are Phase 14).
- Familiarity changes pace and the tour default, not the wording (plain-language hints are Phase 14).
- Personal bests live in one browser's localStorage.

### 5. Ideas for later
- "Continue where you left off" for returning visitors, from the newest autosave.
- A shorter tour for "Work in IT or security".

### 6. Hand-off
Phase 12 (ATT&CK tags, incident response phases, threat actors, report card).

---

## Phase 12 — Speak the industry's language · 2026-11-21 · ✅ complete

Decisions applied: verify every ATT&CK ID against attack.mitre.org before using it; derive response
phases from existing timings (no simulation change); actors and the planner only in free play, with
"Mixed" as an exact no-op so saves and replays are unchanged; a PNG report card without a library.

### 1. Summary
- **MITRE ATT&CK** (`engine/incidents/attack.ts`): techniques per adversarial incident kind, linked chips
  in the report, a line per incident in the Markdown export. Operational incidents have none.
- **Response phases** (`engine/incidents/phases.ts`): detection, containment, eradication & recovery per
  incident; MTTD, MTTC and MTTR tiles and Markdown rows.
- **Threat actors** (`engine/incidents/actors.ts`): Mixed, Opportunists, Ransomware gang, Fraud ring and
  Insider, as weight and pace multipliers on the exposure model; picker in the Play sheet.
- **Attack planner** (`engine/incidents/planner.ts`): the Ransomware gang routes to the crown jewels
  (Dijkstra over the hops the firewall allows, cost −ln(chance)), replans every move, reroutes around
  isolation and rule changes, and falls back to probing with no route.
- **Report card** (`ui/report-card.ts`): a one-page PNG summary from the after-action report.

### 2. Tests run
| Check | How | Result |
|---|---|---|
| ATT&CK facts | 14 IDs looked up on attack.mitre.org | ✅ 13 confirmed active with matching names; T1656 page empty, left out |
| Typecheck | `npm run typecheck` | ✅ |
| Unit tests | `npx vitest run --testTimeout=30000` | ✅ **222 passed, 23 files** (7 WASM tests skipped without a local WASM build) |
| New tests | `attack`, `phases`, `actors`, `planner`, `report-card` | ✅ 3 + 5 + 6 + 9 + 5 |
| Replay and saves | Existing whole-game replay and save tests with the new fields | ✅ unchanged |
| Build | `npm run build` | ✅ |
| Report card render | Sample card opened in Chrome at 1200×800 | ✅ after two layout fixes (below) |

### 3. Issues found & resolved
| Symptom | Cause | Fix |
|---|---|---|
| Planner logged "Rerouted" when moving on after taking a goal | Any change of goal or next hop counted as a reroute | Compare the unheld parts of the routes; "Next target" when the old goal is held |
| Reroute test passed or failed by timing | It isolated devices after the attack had effectively finished | Isolate the database before the first move and assert the plan avoids it |
| Technique names cut short and right edges misaligned on the card | Chip text clipped at 22 characters; grade and chips anchored past the 1120 px edge | Clip at 26 at 14 px; align everything to 1120 |
| 200-node speed test failed in some full runs | 10 ms/tick wall-clock limit while 20+ test files run in parallel on a busy laptop | Passes alone and in CI; left as is, noted here |
| Docs written through `node -e` lost their code spans | Bash ran the backticks inside the double-quoted script | Edits and scripts now go through files or the editor, never inline backticks |

### 4. Known limitations / debt
- Only free-play ransomware from the Ransomware gang plans; scenarios keep the scripted spread.
- The planner doesn't model credentials or privilege; every hop uses the same two odds.
- The report card is PNG only, and uses system fonts in the image.
- The 200-node speed test is sensitive to machine load.

### 5. Ideas for later
- Draw the planned route on the map while an incident is detected.
- Let scenarios opt in to the planner.
- Run the 200-node speed test on its own, outside the parallel suite.

### 6. Hand-off
Phase 13: the alert triage queue and buyable security controls, with Sigma rules and realistic logs (see
the workflow doc's Stack additions).

---

## Phase 13 — Detection becomes a skill · 2026-11-21 · ✅ complete

Also in this phase: the report card was made smaller (960×540, exported at 1920×1080) and now carries the
Honeypot logo, embedded as a data URL because an SVG drawn as an image can't load files.

### 1. Summary
- **Logs → rules → alerts → triage** in `src/engine/soc/` (logs, rules, soc), wired into the incident
  engine: attack steps leave traces, everyday activity leaves noise, enabled rules raise alerts.
- **Sigma-style rules:** ten rules with selection, filter and condition; Sigma YAML view; can be switched off.
- **Triage:** escalate (a real alert detects its incident now; a false alarm costs £150), dismiss, or let
  expire after 4 h (a missed real alert).
- **Security tools:** EDR, SIEM, email security gateway, immutable backups, paid from each game's budget.
- **UI:** Alerts button and Security operations panel (queue with raw logs, rules, tools); log export as
  JSON Lines; alert triage stats in the report sheet and Markdown.

### 2. Tests run
| Check | How | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | ✅ |
| Unit tests | `npx vitest run --testTimeout=30000` | ✅ **237 passed, 24 files** (7 WASM tests skipped without a local WASM build) |
| New tests | `soc.test.ts`: rule tags, YAML, matching and filters; raw lines and JSONL; quiet sandbox; determinism; escalate detects; false-alarm cost; expiry; disabled rule; tool charges; EDR visibility; email gateway; saves | ✅ 14 passed |
| Existing behaviour | All earlier incident, scenario, replay and save tests | ✅ unchanged |
| Build | `vite build --base=/HoneyPot/` | ✅ |
| Browser | Sample business, EDR and SIEM deployed, intense free play against the Ransomware gang at 16× | ✅ alerts arrived, panel, tabs and tools worked |
| Report card | Sample card with the logo opened in Chrome at 960×540 | ✅ |

### 3. Issues found & resolved
| Symptom | Cause | Fix |
|---|---|---|
| Two SOC tests read an incident that wasn't there | During a game the view hides undetected incidents (by design) | Tests assert it is hidden before escalation and visible after |
| New preview server exited at once | An earlier preview process still held port 4599 | Stopped that process (verified by its command line first) |
| Phase 13 docs missing from the code commit | A workspace hook blocked the doc edits | Added in a follow-up commit |

### 4. Known limitations / debt
- **Scoring:** data theft costs 0.08 points per MB, so an exfiltration at 30 Mbps floors the score within
  the hour (seen in the browser check: 124.5 GB stolen, score 0). It needs a cap or a log scale.
- Rules can be switched off but not edited; the Sigma subset has no aggregation (`count() by`).
- Phishing that only steals a password (no document) leaves no trace until it moves.
- Triage is by verdict only; there is no investigation step (pivoting through related logs).

### 5. Ideas for later
- Rebalance the data-theft penalty.
- A rule editor (fields and thresholds), with a replay showing alerts gained and lost.
- An investigation view: all logs for a host or account around an alert's time.

### 6. Hand-off
Phase 14: learn mode (guided lessons per topic), staff awareness training, the Cyber Essentials gap report,
the reviewer demo, and a README case study with a GIF. Rebalancing the data-theft penalty first is worth
considering.

---

## Phase 14 — Learn mode and polish · 2026-11-21 · ✅ complete

Decisions applied: rebalance the data-theft penalty first (the Phase 13 debt); check the Cyber Essentials
wording against the NCSC's current document rather than memory; list what can't be assessed instead of
passing it; lessons check the live network instead of asking "done?"; the demo saves nothing.

### 1. Summary
- **Scoring:** capped log penalty for stolen data; containment clocks stop at game end.
- **Cyber Essentials gap report** (`engine/compliance/`): five controls from v3.3 (April 2026), one-click
  fixes, Markdown export, an n/5 badge in the top bar.
- **Change default password:** a new undoable command, a prompt in the inspector, and the attack model
  reads it.
- **Staff awareness training:** a fifth security tool that stops some phishing and invoice fraud.
- **Learn mode:** four self-completing lessons per learn topic, started by onboarding or the Lessons sheet;
  wording follows familiarity (the Phase 11 debt).
- **Reviewer demo:** `?demo` starts a busy game at once with a banner explaining it.
- **README:** live links, demo GIF, new features and a case study.

### 2. Tests run
| Check | How | Result |
|---|---|---|
| Cyber Essentials facts | NCSC overview and resources pages; requirements PDF v3.3 text extracted locally | ✅ version and date, five control names, 14 days / CVSS 7, MFA for cloud, malware options, backups not required |
| Typecheck | `npm run typecheck` | ✅ |
| Unit tests | `npx vitest run --testTimeout=60000` | ✅ **252 passed, 26 files** (7 WASM tests skipped without a local WASM build) |
| New tests | `cyber-essentials.test.ts` (7), `lessons.test.ts` (5), awareness training, data penalty, event labels | ✅ |
| Build | `npm run build` | ✅ main chunk 84 KB gzipped |
| Browser | Gap report and its fixes (password, MFA, EDR, update tonight); lesson card completing from the inspector; `?demo` through to the after-action report | ✅ |

### 3. Issues found & resolved
| Symptom | Cause | Fix |
|---|---|---|
| Final score kept falling after a game ended | Open incidents' containment time used the live clock; hidden while data theft floored the score at 0 | Record the finish tick and stop the clocks there |
| "undefined recovered" / "undefined down" in the activity feed | Labels cached at boot didn't include apps incidents inject (exfil, DDoS) | One `appName` helper with a fallback; regression test over the multi-incident scenario |
| Edge-patching lesson step could never complete | The ISP router is provider-managed and can't be patched by the player | Provider-managed devices are excluded from the patch checks |
| Lesson card unreadable over the map | Translucent "glass" background | Solid surface with a shadow, capped height |
| Screen recording stopped after 5 s | The page stops painting while the browser is in the background | GIF built from screenshots of each stage instead |
| Two timing tests failed in one full run | Wall-clock limits under parallel load (known) | Pass alone (47/47) and in the next full run |

### 4. Known limitations / debt
- The gap report assesses only what the simulation models; it isn't a certification check.
- Malware protection counts only EDR; real built-in antivirus would qualify.
- Lessons are written for the kinds of devices every business has, but the task text names the sample
  business's devices.
- The demo GIF is a slideshow of stills, not a recording.

### 5. Ideas for later
- Lessons for the "threats" topics, and a lesson for the alert queue itself.
- Re-run the gap report at the end of a game and put the result on the report card.
- An investigation view and a rule editor (from Phase 13).

### 6. Hand-off
The planned phases are done. Next candidates: the investigation view, scenarios opting into the attack
planner, and a manual screen-reader audit.
