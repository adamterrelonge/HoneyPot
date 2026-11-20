<p align="center">
  <img src="public/favicon-512.png" alt="Honeypot logo" width="96" />
</p>

<h1 align="center">Honeypot</h1>

<p align="center">
  <strong>A browser-based business network simulator.</strong><br />
  Build a business, watch its network run, then defend it against realistic outages and attacks.
</p>

<p align="center">
  <a href="https://github.com/adamterrelonge/HoneyPot/actions/workflows/ci.yml"><img src="https://github.com/adamterrelonge/HoneyPot/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT licence" /></a>
</p>

---

## What it is

Honeypot generates a realistic network for a business you describe, from a small office up to a
multi-site enterprise. It draws the network on a clean isometric map with live traffic. You then
live through real-world situations and respond to them: outages, ransomware, phishing,
misconfigurations, failed firmware updates and capacity problems.

It's built for people learning how business networks behave and fail: IT generalists, students,
SME owners and security trainees. It favours **clarity over completeness** and **cause and effect
over packet-level accuracy**. Every failure can be traced back to a cause you can see.

> **Safety:** Honeypot is a closed simulation. It never touches real hosts, never scans and never
> sends network traffic beyond loading its own assets. It contains no exploit code.

## Features

- **Business generator.** Pick a name, industry, size (SME, mid-size or enterprise), number of sites,
  cloud or on-premises hosting, budget and compliance needs. A live preview shows the result.
  - Industries: Professional services, Retail, Healthcare, Manufacturing, Education, Logistics.
  - Large departments become group nodes ("Finance · 40 laptops") that expand as you zoom in.
- **Live simulation.** Runs in a Web Worker on a fixed-tick clock (pause, 1×, 4×, 16×, step).
  - Traffic is modelled as flows between services, with link utilisation, latency and loss.
  - Service dependencies: DNS → sign-in → app.
  - Animated traffic along cables that lie on the floor and follow the grid.
- **Policy and identity.** Zones, subnets and VLANs, ordered firewall rules, roles with per-app
  access and MFA.
- **Trace tool.** Pick a source and a destination to see the hop-by-hop path and the exact rule,
  link or permission that allows or blocks it.
- **Device lifecycle and firmware.** A firmware catalogue with real CVE references (checked against
  NVD and the CISA KEV list), install now or in tonight's maintenance window, brick risk, rollback,
  hardware ageing and failure, and a vulnerability exposure view.
- **Incidents and scenarios.** 14 incident types, including ransomware (office and production line),
  phishing and account takeover, DDoS, ISP outage, DNS misconfiguration, expired certificates,
  credential stuffing, a compromised software update and invoice fraud.
  - 12 scripted scenarios plus free play.
  - Business impact in £, a response budget, a running score and an after-action report.
  - Deploy **honeypot decoys** that raise the alarm when an attacker touches them.
- **Undo, saves and sharing.** Undo and redo outside games, named saves plus a daily autosave
  (IndexedDB), copyable share codes and Markdown export of the after-action report.
- **Accessibility.** Built to WCAG 2.2 AA.
  - Light and dark themes (follows the system, or toggle manually).
  - A full table view of the network for keyboard and screen-reader users.
  - Skip links, focus-managed dialogs, live announcements and reduced-motion support.
- **Guided tour.** A 10-step tour of the real UI, offered after you create a business.
- **Desktop, tablet and phone.** Landscape and portrait tablet layouts with touch pan and
  pinch-zoom; on phones (down to 320 px wide, which also covers 400% browser zoom) panels take the
  full height.

## Getting started

Requirements: **Node.js 20+** (developed on Node 24) and npm.

```bash
git clone https://github.com/adamterrelonge/HoneyPot.git
cd HoneyPot
npm install
npm run dev
```

Open the URL Vite prints (usually <http://localhost:5173>). Create a business, or choose
**Use the sample business**, then press **Play**.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | Type-check the app and the engine (separate configs) |
| `npm test` | Run the Vitest suite |
| `npm run check` | Typecheck, test and build in one go |
| `npm run build:wasm` | Build the Rust engine to WebAssembly (needs Rust and the `wasm32-unknown-unknown` target); enables the parity tests |

### Controls

| Action | Input |
|---|---|
| Pan the map | Drag (one finger on touch) |
| Zoom | Mouse wheel or pinch |
| Select a device | Click or tap it, or pick it from the device list |
| Pause / resume | <kbd>Space</kbd> |
| Close a panel or clear selection | <kbd>Esc</kbd> |

Dev only: add `?stress=200` to the URL to load a synthetic 200-node topology.

## Tech stack

| Concern | Choice |
|---|---|
| Build | Vite 8 |
| UI | React 19, TypeScript 7 (`strict`) |
| Rendering | PixiJS 8 (WebGL), isometric scene |
| State | Zustand 5 |
| Graph | graphology |
| Schemas | Zod 4 |
| Worker RPC | Comlink 4 |
| Styling | Tailwind CSS 4 and CSS custom properties |
| Tests | Vitest; generator golden hashes; Lighthouse for accessibility |
| CI | GitHub Actions: web app, Rust engine and API jobs |
| Engine hot paths (draft) | Rust → WebAssembly (`engine-rs/`) |
| Backend (draft, optional) | Python: FastAPI, Pydantic, SQLAlchemy (`api/`) |

## Architecture

```
┌──────────────── Main thread ────────────────┐      ┌────────── Web Worker ─────────┐
│ React UI  (TopBar, Sidebar, Inspector, …)   │      │ Engine (pure TypeScript)      │
│   │ intents ▼          ▲ UI state           │ cmd  │  World  (graphology)          │
│ Zustand store (selection, panels, mode)     │─────►│  Clock  (fixed tick, speed)   │
│   │ subscribe                               │◄─────│  Flows / Reachability / Policy│
│ Pixi Scene (grid, zones, links, nodes, fx)  │ snap │  Incidents / Scenario runner  │
└─────────────────────────────────────────────┘      │  Seeded RNG, Command log      │
                                                     └───────────────────────────────┘
```

Core principles:

1. **The engine is pure TypeScript.** `src/engine/**` never imports React, Pixi, Zustand or the DOM.
   `tsconfig.engine.json` enforces this.
2. **Simulation state never lives in React.** The worker pushes read-only snapshots, and React holds
   UI state only.
3. **Every change is a command**, which enables undo, replay, saves and after-action reports.
4. **Deterministic.** All randomness uses a seeded RNG, so the same seed and commands always give the
   same result.
5. **Simulate flows, not packets.**

```
src/
  engine/    pure TS simulation: model, catalogue, graph, sim/, gen/, policy/, firmware/, incidents/, save/
  worker/    sim.worker.ts (owns the simulation), wire.ts (compact snapshot transport)
  render/    isometric maths, cable routing, Pixi scene, theme
  state/     UI store, snapshot mirror, preferences, viewport
  persist/   IndexedDB saves, share codes
  ui/        React panels, wizard, tour, accessibility components
  wasm/      loader and parity tests for the Rust engine
  data/      sample topology
public/emoji device, industry and logo artwork
engine-rs/   Rust port of engine hot paths, compiled to WebAssembly (draft)
api/         optional FastAPI backend: share links and leaderboards (draft)
```

## Beyond the browser (drafts)

Two optional extensions. Neither is needed to run Honeypot.

**Rust → WebAssembly engine (`engine-rs/`).** Firewall policy evaluation, which runs for every
traffic flow on every tick, is ported line for line from TypeScript. The TypeScript engine stays
the reference, and parity tests check that both give identical decisions (allowed, deciding rule
and reason text) for 2,000 random flows on a generated business in each of the six industries.

The first version passed JSON across the boundary and was **3–4× slower** than TypeScript:
serialising cost more than the rule check. The second keeps the topology resident in WASM memory,
interns strings to integers and exchanges typed arrays. Measured on 100,000 decisions (Node 24):

| Rules | TypeScript | Rust/WASM (resident) | Speed-up |
|---|---|---|---|
| 7 | 15.4 ms | 2.8 ms | 5.4× |
| 60 | 102 ms | 12.2 ms | 8.3× |

The simulation doesn't use it yet. Next steps are flow routing, then the whole tick loop.

**FastAPI backend (`api/`).** Share links (publish a save, open it anywhere by a short id) and
per-scenario leaderboards. The server checks a save's envelope and stores it as received; the
browser engine validates it and checks its hash when it is opened. Grades are computed on the
server. See [`api/README.md`](api/README.md) for endpoints, configuration and what's still to do.

[`build.md`](build.md) is the full design reference: architecture, domain model, an abstraction
ledger of what is and isn't simulated, and the phase plan. [`BUILD_DIARY.md`](BUILD_DIARY.md)
records what was built in each phase, with test results and decisions.

## Project status

Phases 1–10 are complete: foundation, simulation core, business generator, policy and trace,
firmware lifecycle, incidents and scoring, saves and sharing, accessibility and performance,
content plus tablet support, and release readiness (CI, licence, phones, bundle split). The web
app has 195 tests across 18 test files; the Rust engine has 8.

Lighthouse scores 100 for accessibility, best practices and SEO at phone (390 px) and tablet
portrait (768 px) sizes.

Known limitations:

- Layout at 200% and 400% zoom has been checked, but there hasn't yet been a manual audit with
  real screen readers (NVDA, VoiceOver) or in Windows high-contrast mode.
- The map itself is pointer and touch only. Keyboard users work through the device list, inspector
  and table view.
- On phones the map is small and best used with the device list; the layout is designed for
  tablets and up.
- Saves live in your browser's IndexedDB. Use share codes to move a business between browsers
  (the draft backend adds share links).

## Credits

The Honeypot logo, the industry images (`public/emoji/industry-*.png`) and the ISP device image
are custom artwork for this project.

Other device artwork uses [Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji) (MIT).
See [`public/emoji/LICENSE-fluentui-emoji.txt`](public/emoji/LICENSE-fluentui-emoji.txt).

CVE data references public records from the [NVD](https://nvd.nist.gov/) and the
[CISA Known Exploited Vulnerabilities](https://www.cisa.gov/known-exploited-vulnerabilities-catalog)
catalogue.

## License

[MIT](LICENSE). Third-party artwork keeps its own licence (see Credits).
