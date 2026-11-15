/**
 * Imperative Pixi scene (build.md §5). React owns exactly one instance via NetworkCanvas.
 * Layers (bottom → top): grid, zone floors, zone labels, cables, highlighted cables,
 * traffic particles, nodes, labels.
 */
import {
  Application,
  Assets,
  Container,
  DashLineShader,
  Graphics,
  Matrix,
  Particle,
  ParticleContainer,
  SmoothGraphics,
  Sprite,
  Text,
  type FederatedPointerEvent,
  type Texture,
  type Ticker,
} from "pixi.js";
import type { NetNode, Topology } from "../engine/model";
import type { Speed } from "../engine/sim/clock";
import { APP_INFO } from "../engine/sim/demands";
import { SEVERITY_RANK, advisoryByCve, type Severity } from "../engine/firmware/catalog";
import type { FlowState, Snapshot, TraceResult } from "../engine/sim/types";
import { TILE_W, boundsOf, depth, project, rectCorners, tileCentre, type Pt } from "./geometry";
import { cumulative, pointAlong, routeLinks, type LinkRoute } from "./routing";
import {
  CATEGORY_COLORS,
  COLORS,
  FONT_STACK,
  MEDIUM_STYLE,
  NODE_ART,
  STATUS_COLORS,
  ZONE_STYLE,
  emojiUrl,
} from "./theme";

export interface SceneEvents {
  onSelect(id: string | null): void;
  onHover(id: string | null): void;
  onZoom(scale: number): void;
}

export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const MIN_ZOOM = 0.15;
/** Below this zoom, device labels fade out and zone name tags take over (semantic zoom). */
const OVERVIEW_ZOOM = 0.55;
/** Above this zoom, group nodes fan out into a small crowd of devices. */
const GROUP_EXPAND_ZOOM = 1.05;
export const MAX_ZOOM = 2.6;
const ZONE_THICKNESS = 8;
const DRAG_THRESHOLD = 4;
/** Particle budget (build.md Phase 2 acceptance: 2k particles at 60 fps). */
export const MAX_PARTICLES = 2400;
const PARTICLE_SPEED = 52; // px/s at 1×

interface NodeView {
  node: NetNode;
  root: Container;
  body: Container;
  sprite: Sprite;
  dot: Graphics;
  shadow: Graphics;
  ring: SmoothGraphics;
  label: Container;
  lift: number;
  ringAlpha: number;
  alpha: number;
  statusAlpha: number;
  /** Group nodes only: ghost copies behind the icon (far) and a small crowd (near). */
  stack: Container | null;
  cluster: Container | null;
  /** Risk lens ring (worst known vulnerability). */
  risk: SmoothGraphics;
}

interface ZoneTag {
  tag: Container;
  /** Zone diamond width in world px, and the tag's own width in screen px. */
  zoneWidth: number;
  tagWidth: number;
}

interface Stream {
  flow: FlowState;
  points: Pt[];
  cum: number[];
  length: number;
  count: number;
  phase: number;
  tint: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const RISK_COLORS: Record<Severity, number> = { critical: 0xff3b30, high: 0xff9f0a, medium: 0xffcc00, low: 0x8e8e93 };

/**
 * Scale a sprite uniformly so its longest side is `size`. Device artwork can have any aspect
 * ratio (custom images included), so it is never stretched to a square.
 */
function fitSprite(s: Sprite, size: number): void {
  const t = s.texture;
  s.scale.set(size / Math.max(t.width, t.height, 1));
}

export class NetworkScene {
  private app = new Application();
  private ready: Promise<void> | null = null;
  private dead = false;
  private disposers: (() => void)[] = [];

  private world = new Container({ isRenderGroup: true });
  private gridG = new SmoothGraphics();
  private floorG = new SmoothGraphics();
  private zoneLabels = new Container();
  private linkG = new SmoothGraphics();
  private linkDashG = new SmoothGraphics();
  private linkDownG = new SmoothGraphics();
  private linkHiG = new SmoothGraphics();
  private traceG = new SmoothGraphics();
  private traceResult: TraceResult | null = null;
  private riskLens = false;
  private particles = new ParticleContainer({ dynamicProperties: { position: true, color: true } });
  private nodeLayer = new Container({ sortableChildren: true });
  private labelLayer = new Container();
  private zoneTagLayer = new Container();
  private zoneTags: ZoneTag[] = [];
  private dashShader = new DashLineShader({ dash: 5, gap: 4 });
  private downShader = new DashLineShader({ dash: 3, gap: 4 });

  private topology: Topology | null = null;
  private views = new Map<string, NodeView>();
  private routes = new Map<string, LinkRoute>();
  private selected: string | null = null;
  private hovered: string | null = null;
  private related = new Set<string>();

  private snap: Snapshot | null = null;
  private linkKey = "";
  private streams: Stream[] = [];
  private pool: Particle[] = [];
  private speed: Speed = 1;
  private running = true;

  private cam = { x: 0, y: 0, s: 1 };
  private target = { x: 0, y: 0, s: 1 };
  private insets: Insets = { left: 0, right: 0, top: 0, bottom: 0 };
  private drag: { x: number; y: number; camX: number; camY: number } | null = null;
  private dragMoved = false;
  private userMoved = false;
  private time = 0;

  constructor(private readonly events: SceneEvents) {}

  mount(host: HTMLElement, topology: Topology): Promise<void> {
    this.ready = (async () => {
      await this.app.init({
        resizeTo: host,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        backgroundAlpha: 0,
        preference: "webgl",
      });
      if (this.dead) return;
      host.appendChild(this.app.canvas);

      const kinds = [...new Set(topology.nodes.map((n) => n.kind))];
      const textures: Record<string, Texture> = await Assets.load(
        kinds.map((k) => ({ src: emojiUrl(k), data: { autoGenerateMipmaps: true } })),
      );
      if (this.dead) return;

      this.world.addChild(
        this.gridG, this.floorG, this.zoneLabels, this.linkG, this.linkDashG, this.linkDownG, this.linkHiG, this.traceG,
        this.particles, this.nodeLayer, this.labelLayer, this.zoneTagLayer,
      );
      this.app.stage.addChild(this.world);

      this.build(topology, (kind) => textures[emojiUrl(kind)]!);
      this.makeParticlePool();
      this.bindInput();
      this.app.ticker.add(this.tick);
      this.fit(true);
      // Keep the map framed on window resize until the user takes control of the camera.
      const onResize = () => !this.userMoved && this.fit(true);
      this.app.renderer.on("resize", onResize);
      this.disposers.push(() => this.app.renderer.off("resize", onResize));
      if (this.snap) this.applySnapshot(this.snap);
    })();
    return this.ready;
  }

  destroy(): void {
    this.dead = true;
    const ready = this.ready ?? Promise.resolve();
    ready
      .catch(() => undefined)
      .then(() => {
        this.disposers.forEach((d) => d());
        this.app.ticker?.remove(this.tick);
        this.app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
      });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  setInsets(insets: Insets): void {
    this.insets = insets;
  }

  setSelection(id: string | null): void {
    if (id === this.selected) return;
    this.selected = id;
    this.refreshFocus();
  }

  setHover(id: string | null): void {
    if (id === this.hovered) return;
    this.hovered = id;
    this.refreshFocus();
  }

  /** Debug counters for performance checks (exposed as `window.__honeypotScene` in dev). */
  stats(): { nodes: number; links: number; streams: number; particles: number } {
    const particles = this.streams.reduce((s, x) => s + x.count, 0);
    return { nodes: this.views.size, links: this.routes.size, streams: this.streams.length, particles: Math.min(particles, MAX_PARTICLES) };
  }

  /** Trace tool: highlight the traced path (green up to the break, red at it, grey after). */
  setTrace(result: TraceResult | null): void {
    this.traceResult = result;
    this.refreshFocus();
  }

  /** Risk lens: ring each device in the colour of its worst known vulnerability. */
  setRiskLens(on: boolean): void {
    if (on === this.riskLens) return;
    this.riskLens = on;
    this.updateNodes();
  }

  setClock(speed: Speed, running: boolean): void {
    this.speed = speed;
    this.running = running;
  }

  /** Apply a simulation snapshot: cable states, node badges and traffic streams. */
  applySnapshot(snap: Snapshot): void {
    this.snap = snap;
    if (!this.topology) return;
    this.drawLinks();
    this.updateNodes();
    this.updateStreams();
  }

  zoomBy(factor: number): void {
    const s = this.app.screen;
    const cx = this.insets.left + (s.width - this.insets.left - this.insets.right) / 2;
    const cy = this.insets.top + (s.height - this.insets.top - this.insets.bottom) / 2;
    this.zoomAt(cx, cy, this.target.s * factor, false);
  }

  focus(id: string): void {
    const view = this.views.get(id);
    if (!view) return;
    const s = clamp(Math.max(this.target.s, 1.15), MIN_ZOOM, MAX_ZOOM);
    const screen = this.app.screen;
    const cx = this.insets.left + (screen.width - this.insets.left - this.insets.right) / 2;
    const cy = this.insets.top + (screen.height - this.insets.top - this.insets.bottom) / 2;
    this.target = { x: cx - view.root.x * s, y: cy - (view.root.y - 24) * s, s };
    this.events.onZoom(s);
  }

  fit(instant = false): void {
    if (!this.topology) return;
    const corners = this.topology.zones.flatMap((z) => rectCorners(z.origin.x, z.origin.y, z.size.w, z.size.h));
    const b = boundsOf(corners);
    b.minY -= 70; // room for the tallest sprites on the back row
    b.maxY += ZONE_THICKNESS + 24;
    const pad = 32;
    const screen = this.app.screen;
    const w = Math.max(100, screen.width - this.insets.left - this.insets.right - pad * 2);
    const h = Math.max(100, screen.height - this.insets.top - this.insets.bottom - pad * 2);
    const s = clamp(Math.min(w / (b.maxX - b.minX), h / (b.maxY - b.minY)), MIN_ZOOM, 1.3);
    this.target = {
      s,
      x: this.insets.left + pad + (w - (b.maxX - b.minX) * s) / 2 - b.minX * s,
      y: this.insets.top + pad + (h - (b.maxY - b.minY) * s) / 2 - b.minY * s,
    };
    if (instant) this.cam = { ...this.target };
    this.events.onZoom(s);
  }

  // ── Building ──────────────────────────────────────────────────────────────

  private build(t: Topology, texture: (kind: NetNode["kind"]) => Texture): void {
    this.topology = t;
    this.drawGrid(t);
    this.drawZones(t);
    for (const n of t.nodes) this.addNode(n, texture(n.kind));
    this.routes = routeLinks(t);
    this.drawLinks();
  }

  private drawGrid(t: Topology): void {
    const maxX = Math.max(...t.zones.map((z) => z.origin.x + z.size.w)) + 3;
    const maxY = Math.max(...t.zones.map((z) => z.origin.y + z.size.h)) + 3;
    const g = this.gridG;
    for (let x = -3; x <= maxX; x++) {
      const a = project(x, -3);
      const b = project(x, maxY);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    for (let y = -3; y <= maxY; y++) {
      const a = project(-3, y);
      const b = project(maxX, y);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    g.stroke({ width: 1, color: COLORS.hairline, alpha: 0.045, pixelLine: true });
  }

  private drawZones(t: Topology): void {
    const g = this.floorG;
    for (const z of t.zones) {
      const style = ZONE_STYLE[z.kind];
      const [T, R, B, L] = rectCorners(z.origin.x, z.origin.y, z.size.w, z.size.h);
      const d = ZONE_THICKNESS;
      // Front faces give the floor plate a little thickness.
      g.poly([L.x, L.y, B.x, B.y, B.x, B.y + d, L.x, L.y + d]).fill({ color: style.side });
      g.poly([B.x, B.y, R.x, R.y, R.x, R.y + d, B.x, B.y + d]).fill({ color: style.side, alpha: 0.75 });
      g.poly([T.x, T.y, R.x, R.y, B.x, B.y, L.x, L.y]).fill({ color: style.top });
      g.poly([T.x, T.y, R.x, R.y, B.x, B.y, L.x, L.y]).stroke({ width: 1, color: style.edge, pixelLine: true });

      // Inner tile lines.
      for (let i = 1; i < z.size.w; i++) {
        const a = project(z.origin.x + i, z.origin.y);
        const b = project(z.origin.x + i, z.origin.y + z.size.h);
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      }
      for (let j = 1; j < z.size.h; j++) {
        const a = project(z.origin.x, z.origin.y + j);
        const b = project(z.origin.x + z.size.w, z.origin.y + j);
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      }
      g.stroke({ width: 1, color: style.edge, alpha: 0.45, pixelLine: true });

      // Label lying flat on the floor along the front-left edge.
      const label = new Text({
        text: z.name.toUpperCase(),
        style: { fontFamily: FONT_STACK, fontSize: 15, fontWeight: "600", letterSpacing: 2.5, fill: COLORS.ink3 },
        resolution: 4,
      });
      label.anchor.set(0, 1);
      const at = project(z.origin.x + 0.35, z.origin.y + z.size.h - 0.2);
      label.setFromMatrix(new Matrix(1, 0.5, -1, 0.5, at.x, at.y));
      label.alpha = 0.75;
      this.zoneLabels.addChild(label);

      // Overview tag: screen-aligned zone name + device count, shown when zoomed far out.
      const devices = t.nodes
        .filter((n) => n.zoneId === z.id && n.kind !== "internet")
        .reduce((s, n) => s + n.count, 0);
      const tag = this.makeZoneTag(z.name, devices);
      const mid = project(z.origin.x + z.size.w / 2, z.origin.y + z.size.h / 2);
      tag.position.set(mid.x, mid.y);
      tag.alpha = 0;
      this.zoneTagLayer.addChild(tag);
      this.zoneTags.push({ tag, zoneWidth: ((z.size.w + z.size.h) * TILE_W) / 2, tagWidth: tag.width });
    }
  }

  /** Stroke a routed cable's visible pieces (crossing gaps already cut out). */
  private strokeRoute(g: SmoothGraphics, r: LinkRoute, color: number, alpha: number): void {
    for (const piece of r.pieces) {
      g.moveTo(piece[0]!.x, piece[0]!.y);
      for (let i = 1; i < piece.length; i++) g.lineTo(piece[i]!.x, piece[i]!.y);
    }
    g.stroke({ width: 1, color, alpha, pixelLine: true });
  }

  private drawLinks(): void {
    const t = this.topology;
    if (!t) return;
    const links = this.snap?.links;
    // Only rebuild geometry when something visible changed.
    const bucket = (u: number) => (u >= 1 ? 3 : u >= 0.8 ? 2 : u > 0.001 ? 1 : 0);
    const key = JSON.stringify(this.snap?.game?.decoys ?? {}) + (links ? t.links.map((l) => `${links[l.id]?.state}${bucket(links[l.id]?.util ?? 0)}`).join("") : "static");
    if (key === this.linkKey) return;
    this.linkKey = key;

    this.linkG.clear();
    this.linkDashG.clear();
    this.linkDownG.clear();
    this.linkDashG.context.customShader = this.dashShader;
    this.linkDownG.context.customShader = this.downShader;
    const decoys = this.snap?.game?.decoys ?? {};
    for (const l of t.links) {
      const r = this.routes.get(l.id);
      if (!r || decoys[l.a] === false || decoys[l.b] === false) continue;
      const s = links?.[l.id];
      const dashed = MEDIUM_STYLE[l.medium].dashed;
      if (s?.state === "down") this.strokeRoute(this.linkDownG, r, STATUS_COLORS.offline, 0.85);
      else if (s?.state === "blocked") this.strokeRoute(this.linkDashG, r, COLORS.link, 0.3);
      else {
        const u = s?.util ?? 0;
        const color = u >= 1 ? STATUS_COLORS.offline : u >= 0.8 ? STATUS_COLORS.degraded : COLORS.link;
        const alpha = u >= 0.8 ? 0.9 : s && u <= 0.001 ? 0.4 : 0.6;
        this.strokeRoute(dashed ? this.linkDashG : this.linkG, r, color, alpha);
      }
    }
  }

  private addNode(n: NetNode, texture: Texture): void {
    const art = NODE_ART[n.kind];
    const c = tileCentre(n.pos.x, n.pos.y);

    const root = new Container({ zIndex: depth(n.pos.x, n.pos.y) });
    root.position.set(c.x, c.y);

    const ring = new SmoothGraphics()
      .ellipse(0, 0, 36, 18)
      .fill({ color: COLORS.accent, alpha: 0.08 })
      .ellipse(0, 0, 36, 18)
      .stroke({ width: 1.5, color: COLORS.accent, pixelLine: true });
    ring.alpha = 0;

    const shadow = new Graphics();
    const k = art.size / 60;
    for (const [rx, ry, a] of [[26, 11, 0.05], [19, 8, 0.07], [12, 5, 0.09]] as const) {
      shadow.ellipse(0, 0, rx * k, ry * k).fill({ color: COLORS.shadow, alpha: a });
    }

    const body = new Container();
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 0.94);
    fitSprite(sprite, art.size);
    sprite.eventMode = "static";
    sprite.cursor = "pointer";
    sprite.on("pointerover", () => !this.drag && this.events.onHover(n.id));
    sprite.on("pointerout", () => this.events.onHover(null));
    sprite.on("pointertap", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      if (!this.dragMoved) this.events.onSelect(n.id);
    });

    const dot = new Graphics();
    dot.position.set(art.size * 0.34, -art.size * 0.82);
    dot.visible = false;

    // Group nodes (build.md §6): a stacked icon with a count when far, a small crowd when near.
    let stack: Container | null = null;
    let cluster: Container | null = null;
    if (n.count > 1) {
      stack = new Container();
      for (const [dx, dy, a] of [[12, -9, 0.35], [6, -4.5, 0.6]] as const) {
        const ghost = new Sprite(texture);
        ghost.anchor.set(0.5, 0.94);
        fitSprite(ghost, art.size * 0.94);
        ghost.position.set(dx, dy);
        ghost.alpha = a;
        stack.addChild(ghost);
      }
      cluster = new Container();
      const spots = [[0, -16], [-22, -6], [22, -6], [-11, 5], [11, 5]] as const;
      for (const [dx, dy] of spots.slice(0, Math.min(5, n.count))) {
        const s = new Sprite(texture);
        s.anchor.set(0.5, 0.94);
        fitSprite(s, art.size * 0.58);
        s.position.set(dx, dy);
        cluster.addChild(s);
      }
      cluster.alpha = 0;
    }
    const badge = n.count > 1 ? this.makeBadge(n.count) : null;
    if (badge) badge.position.set(-art.size * 0.36, -art.size * 0.86);
    body.addChild(...[stack, sprite, cluster, dot, badge].filter((x): x is Container => x !== null));

    const risk = new SmoothGraphics();
    risk.visible = false;
    root.addChild(risk, ring, shadow, body);
    this.nodeLayer.addChild(root);

    const label = this.makeLabel(n.label);
    label.position.set(c.x, c.y + 13);
    this.labelLayer.addChild(label);

    this.views.set(n.id, {
      node: n, root, body, sprite, dot, shadow, ring, label, stack, cluster, risk,
      lift: 0, ringAlpha: 0, alpha: 1, statusAlpha: 1,
    });
  }

  private updateNodes(): void {
    const nodes = this.snap?.nodes;
    if (!nodes) return;
    for (const [id, v] of this.views) {
      const s = nodes[id];
      if (!s) continue;
      // Dormant decoys are invisible until deployed (Phase 6).
      v.root.visible = this.snap?.game?.decoys[id] !== false;
      const device = this.snap?.devices?.[id];
      const updating = device?.condition === "updating";
      const color = s.isolated ? COLORS.ink3 : updating ? COLORS.accent : s.status === "online" ? null : STATUS_COLORS[s.status];
      v.dot.visible = color !== null;
      if (color !== null) v.dot.clear().circle(0, 0, 5.5).fill(0xffffff).circle(0, 0, 4).fill(color);
      v.statusAlpha = updating ? 0.6 : s.status === "offline" ? 0.38 : 1;
      // Risk lens.
      let worst: Severity | null = null;
      for (const cve of device?.advisories ?? []) {
        const a = advisoryByCve(cve);
        if (a && (!worst || SEVERITY_RANK[a.severity] > SEVERITY_RANK[worst])) worst = a.severity;
      }
      v.risk.visible = this.riskLens && worst !== null;
      if (v.risk.visible) {
        const c = RISK_COLORS[worst!];
        v.risk.clear().ellipse(0, 0, 40, 20).fill({ color: c, alpha: 0.14 }).ellipse(0, 0, 40, 20).stroke({ width: 2, color: c, alpha: 0.9 });
      }
    }
  }

  private makeLabel(text: string): Container {
    const box = new Container();
    const t = new Text({
      text,
      style: { fontFamily: FONT_STACK, fontSize: 11, fontWeight: "500", letterSpacing: -0.1, fill: COLORS.ink },
      resolution: 4,
    });
    t.anchor.set(0.5, 0.5);
    const w = Math.ceil(t.width) + 14;
    const bg = new SmoothGraphics()
      .roundRect(-w / 2, -9, w, 18, 9)
      .fill({ color: 0xffffff, alpha: 0.86 })
      .roundRect(-w / 2, -9, w, 18, 9)
      .stroke({ width: 1, color: COLORS.hairline, alpha: 0.08, pixelLine: true });
    box.addChild(bg, t);
    return box;
  }

  /** Small count pill for group nodes, e.g. "40" or "1.2k". */
  private makeBadge(count: number): Container {
    const box = new Container();
    const text = count >= 1000 ? `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k` : String(count);
    const t = new Text({
      text,
      style: { fontFamily: FONT_STACK, fontSize: 10, fontWeight: "700", fill: 0xffffff },
      resolution: 4,
    });
    t.anchor.set(0.5, 0.5);
    const w = Math.max(18, Math.ceil(t.width) + 10);
    const bg = new SmoothGraphics()
      .roundRect(-w / 2, -8, w, 16, 8)
      .fill({ color: COLORS.ink, alpha: 0.82 })
      .roundRect(-w / 2, -8, w, 16, 8)
      .stroke({ width: 1.5, color: 0xffffff, alpha: 0.9 });
    box.addChild(bg, t);
    return box;
  }

  /** Overview tag for a zone (shown when zoomed out). Sized in screen pixels. */
  private makeZoneTag(name: string, devices: number): Container {
    const box = new Container();
    const title = new Text({
      text: name,
      style: { fontFamily: FONT_STACK, fontSize: 13, fontWeight: "600", fill: COLORS.ink, letterSpacing: -0.1 },
      resolution: 3,
    });
    const sub = new Text({
      text: `${devices.toLocaleString()} device${devices === 1 ? "" : "s"}`,
      style: { fontFamily: FONT_STACK, fontSize: 11, fontWeight: "500", fill: COLORS.ink3 },
      resolution: 3,
    });
    title.anchor.set(0.5, 1);
    sub.anchor.set(0.5, 0);
    title.y = 1;
    sub.y = 2;
    const w = Math.ceil(Math.max(title.width, sub.width)) + 22;
    const bg = new SmoothGraphics()
      .roundRect(-w / 2, -20, w, 40, 12)
      .fill({ color: 0xffffff, alpha: 0.9 })
      .roundRect(-w / 2, -20, w, 40, 12)
      .stroke({ width: 1, color: COLORS.hairline, alpha: 0.1, pixelLine: true });
    box.addChild(bg, title, sub);
    return box;
  }

  // ── Traffic particles ─────────────────────────────────────────────────────

  private makeParticlePool(): void {
    const dot = new Graphics().circle(0, 0, 6).fill(0xffffff);
    const texture = this.app.renderer.generateTexture({ target: dot, resolution: 4, antialias: true });
    dot.destroy();
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = new Particle({ texture, anchorX: 0.5, anchorY: 0.5, scaleX: 0.34, scaleY: 0.34, alpha: 0 });
      this.pool.push(p);
      this.particles.addParticle(p);
    }
  }

  /** Build one particle stream per active flow along its cable route (bulk direction). */
  private updateStreams(): void {
    const snap = this.snap;
    if (!snap) return;
    const old = new Map(this.streams.map((s) => [s.flow.id, s]));
    const next: Stream[] = [];
    for (const f of snap.flows) {
      if ((f.status !== "ok" && f.status !== "degraded") || !f.path || f.throughputMbps < 0.01) continue;
      const prev = old.get(f.id);
      const samePath = prev && prev.flow.path?.links.join() === f.path.links.join();
      const geom = samePath ? prev : this.streamGeometry(f);
      if (!geom) continue;
      const spacing = 150 / clamp(Math.sqrt(f.throughputMbps), 0.45, 5);
      next.push({
        flow: f,
        points: geom.points,
        cum: geom.cum,
        length: geom.length,
        count: clamp(Math.round(geom.length / spacing), 1, 40),
        phase: prev?.phase ?? (next.length * 0.618) % 1,
        tint: f.status === "degraded" ? STATUS_COLORS.degraded : CATEGORY_COLORS[APP_INFO[f.app].category],
      });
    }
    // Respect the particle budget by thinning every stream proportionally.
    const total = next.reduce((s, x) => s + x.count, 0);
    if (total > MAX_PARTICLES) {
      const k = MAX_PARTICLES / total;
      for (const s of next) s.count = Math.max(1, Math.floor(s.count * k));
    }
    this.streams = next;
  }

  private streamGeometry(f: FlowState): { points: Pt[]; cum: number[]; length: number } | null {
    const path = f.path!;
    const points: Pt[] = [];
    for (let i = 0; i < path.links.length; i++) {
      const r = this.routes.get(path.links[i]!);
      if (!r) return null;
      const forward = r.a === path.nodes[i];
      points.push(...(forward ? r.points : [...r.points].reverse()));
    }
    if (points.length < 2) return null;
    // Bulk direction: downloads travel server → client.
    if (f.bulk === "toClient") points.reverse();
    const cum = cumulative(points);
    return { points, cum, length: cum[cum.length - 1]! };
  }

  private animateParticles(dt: number): void {
    const v = this.running ? PARTICLE_SPEED * Math.sqrt(this.speed) : 0;
    const sel = this.selected;
    let i = 0;
    for (const s of this.streams) {
      s.phase = (s.phase + (dt * v) / Math.max(1, s.length)) % 1;
      const lit = !this.traceResult && (!sel || s.flow.path!.nodes.includes(sel));
      const alpha = lit ? 0.95 : 0.12;
      for (let k = 0; k < s.count && i < this.pool.length; k++, i++) {
        const p = this.pool[i]!;
        const at = pointAlong(s.points, s.cum, ((s.phase + k / s.count) % 1) * s.length);
        p.x = at.x;
        p.y = at.y;
        p.tint = s.tint;
        p.alpha = alpha;
      }
    }
    for (; i < this.pool.length; i++) {
      const p = this.pool[i]!;
      if (p.alpha === 0) break; // the rest of the pool is already hidden
      p.alpha = 0;
    }
  }

  // ── Focus / highlight ─────────────────────────────────────────────────────

  private refreshFocus(): void {
    const t = this.topology;
    if (!t) return;
    this.related.clear();
    const hi = this.linkHiG.clear();
    const draw = (id: string, alpha: number) => {
      for (const l of t.links) {
        if (l.a !== id && l.b !== id) continue;
        this.related.add(l.a).add(l.b);
        const r = this.routes.get(l.id);
        if (r) this.strokeRoute(hi, r, COLORS.accent, alpha);
      }
    };
    if (this.hovered && this.hovered !== this.selected) draw(this.hovered, 0.5);
    if (this.selected) draw(this.selected, 1);
    this.drawTrace();
    const dim = this.selected !== null || this.traceResult !== null;
    this.linkG.alpha = dim ? 0.45 : 1;
    this.linkDashG.alpha = dim ? 0.45 : 1;
  }

  private drawTrace(): void {
    const g = this.traceG.clear();
    const t = this.traceResult;
    if (!t) return;
    this.related.add(t.from).add(t.to);
    if (!t.path) return;
    for (const id of t.path.nodes) this.related.add(id);
    // Colour each link by whether the trace got past it.
    let state: "ok" | "bad" | "after" = "ok";
    t.path.links.forEach((linkId, i) => {
      if (t.failed?.type === "node" && t.path!.nodes[i] === t.failed.id) state = "after";
      if (t.failed?.type === "link" && t.failed.id === linkId) state = "bad";
      const r = this.routes.get(linkId);
      if (r) {
        for (const piece of r.pieces) {
          g.moveTo(piece[0]!.x, piece[0]!.y);
          for (let k = 1; k < piece.length; k++) g.lineTo(piece[k]!.x, piece[k]!.y);
        }
        // Works: green. Broken at a link/device: blue up to the break, red at it. Blocked by policy: all red.
        const okColor = t.ok ? STATUS_COLORS.online : t.failed ? COLORS.accent : STATUS_COLORS.offline;
        const color = state === "ok" ? okColor : state === "bad" ? STATUS_COLORS.offline : COLORS.link;
        g.stroke({ width: state === "after" ? 1.5 : 3, color, alpha: state === "after" ? 0.5 : 0.95, cap: "round", join: "round" });
      }
      if (state === "bad") state = "after";
    });
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  private bindInput(): void {
    const stage = this.app.stage;
    const canvas = this.app.canvas;
    stage.eventMode = "static";
    stage.hitArea = this.app.screen;

    stage.on("pointerdown", (e: FederatedPointerEvent) => {
      this.drag = { x: e.global.x, y: e.global.y, camX: this.target.x, camY: this.target.y };
      this.dragMoved = false;
    });
    stage.on("globalpointermove", (e: FederatedPointerEvent) => {
      if (!this.drag) return;
      const dx = e.global.x - this.drag.x;
      const dy = e.global.y - this.drag.y;
      if (!this.dragMoved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      this.dragMoved = this.userMoved = true;
      canvas.style.cursor = "grabbing";
      this.target.x = this.cam.x = this.drag.camX + dx;
      this.target.y = this.cam.y = this.drag.camY + dy;
    });
    const end = () => {
      this.drag = null;
      canvas.style.cursor = "";
    };
    stage.on("pointerup", end);
    stage.on("pointerupoutside", end);
    stage.on("pointertap", (e: FederatedPointerEvent) => {
      if (e.target === stage && !this.dragMoved) this.events.onSelect(null);
    });

    // Native wheel: Pixi's listener is passive and can't stop page zoom/scroll.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.userMoved = true;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const pinch = e.ctrlKey; // trackpad pinch arrives as ctrl+wheel
      const mouseWheel =
        !pinch && (e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY)));
      if (pinch || mouseWheel) {
        const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
        const factor = Math.exp(-dy * (pinch ? 0.01 : 0.0018));
        this.zoomAt(px, py, this.target.s * factor, pinch);
      } else {
        // Two-finger trackpad scroll pans, like Maps.
        this.target.x = this.cam.x = this.target.x - e.deltaX;
        this.target.y = this.cam.y = this.target.y - e.deltaY;
      }
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    this.disposers.push(() => canvas.removeEventListener("wheel", onWheel));
  }

  private zoomAt(px: number, py: number, scale: number, instant: boolean): void {
    const s = clamp(scale, MIN_ZOOM, MAX_ZOOM);
    const wx = (px - this.target.x) / this.target.s;
    const wy = (py - this.target.y) / this.target.s;
    this.target = { s, x: px - wx * s, y: py - wy * s };
    if (instant) this.cam = { ...this.target };
    this.events.onZoom(s);
  }

  // ── Frame loop ────────────────────────────────────────────────────────────

  private tick = (ticker: Ticker): void => {
    const dt = ticker.deltaMS;
    this.time += dt / 1000;
    const k = 1 - Math.exp(-dt / 90);
    this.cam.x += (this.target.x - this.cam.x) * k;
    this.cam.y += (this.target.y - this.cam.y) * k;
    this.cam.s += (this.target.s - this.cam.s) * k;
    this.world.position.set(this.cam.x, this.cam.y);
    this.world.scale.set(this.cam.s);

    this.animateParticles(dt / 1000);

    const ease = 1 - Math.exp(-dt / 70);
    const labelZoomAlpha = clamp((this.cam.s - OVERVIEW_ZOOM) / 0.15, 0, 1);
    const groupExpand = clamp((this.cam.s - GROUP_EXPAND_ZOOM) / 0.3, 0, 1);
    for (const { tag, zoneWidth, tagWidth } of this.zoneTags) {
      // Only label zones big enough on screen to hold their tag, so neighbours don't collide.
      const fits = zoneWidth * this.cam.s > tagWidth * 1.15;
      tag.alpha = fits ? 1 - labelZoomAlpha : 0;
      tag.visible = tag.alpha > 0.01;
      tag.scale.set(1 / this.cam.s); // constant on-screen size
    }
    for (const [id, v] of this.views) {
      const isSel = id === this.selected;
      const isHover = id === this.hovered;
      const lit = (!this.selected && !this.traceResult) || isSel || this.related.has(id);

      v.lift += ((isSel || isHover ? -6 : 0) - v.lift) * ease;
      v.body.y = v.lift;
      v.shadow.scale.set(1 + v.lift * 0.02);
      if (v.cluster && v.stack) {
        // Semantic zoom: the stacked icon cross-fades into a crowd. The (invisible) main sprite
        // keeps receiving pointer events either way.
        v.sprite.alpha = v.statusAlpha * (1 - groupExpand);
        v.stack.alpha = 1 - groupExpand;
        v.stack.visible = v.stack.alpha > 0.01;
        v.cluster.alpha = v.statusAlpha * groupExpand;
        v.cluster.visible = v.cluster.alpha > 0.01;
      } else {
        v.sprite.alpha = v.statusAlpha;
      }

      v.ringAlpha += ((isSel ? 1 : 0) - v.ringAlpha) * ease;
      v.ring.alpha = v.ringAlpha;
      v.ring.visible = v.ringAlpha > 0.01; // alpha-0 objects still cost a draw call
      if (isSel) v.ring.scale.set(1 + Math.sin(this.time * 3) * 0.035);

      v.alpha += ((lit ? 1 : 0.35) - v.alpha) * ease;
      v.root.alpha = v.alpha;
      v.label.alpha = isSel || isHover ? 1 : v.alpha * labelZoomAlpha;
      v.label.visible = v.label.alpha > 0.01 && v.root.visible;
    }
  };
}
