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
