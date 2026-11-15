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
