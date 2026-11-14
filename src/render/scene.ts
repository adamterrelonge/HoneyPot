/**
 * Imperative Pixi scene (build.md §5). React owns exactly one instance via NetworkCanvas.
 * Layers (bottom → top): grid, zone floors, zone labels, links, highlighted links, nodes, labels.
 */
import {
  Application,
  Assets,
  Container,
  DashLineShader,
  Graphics,
  Matrix,
  SmoothGraphics,
  Sprite,
  Text,
  type FederatedPointerEvent,
  type Texture,
  type Ticker,
} from "pixi.js";
import type { NetNode, Topology } from "../engine/model";
import {
  boundsOf,
  depth,
  linkCurve,
  project,
  rectCorners,
  tileCentre,
  type Cubic,
  type Pt,
} from "./geometry";
import {
  COLORS,
  FONT_STACK,
  LINK_ANCHOR_LIFT,
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

export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 2.6;
const ZONE_THICKNESS = 8;
const DRAG_THRESHOLD = 4;

interface NodeView {
  node: NetNode;
  root: Container;
  body: Container;
  shadow: Graphics;
  ring: SmoothGraphics;
  label: Container;
  lift: number;
  ringAlpha: number;
  alpha: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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
  private linkHiG = new SmoothGraphics();
  private nodeLayer = new Container({ sortableChildren: true });
  private labelLayer = new Container();

  private topology: Topology | null = null;
  private views = new Map<string, NodeView>();
  private curves = new Map<string, Cubic>();
  private selected: string | null = null;
  private hovered: string | null = null;
  private related = new Set<string>();

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

      this.linkDashG.context.customShader = new DashLineShader({ dash: 5, gap: 4 });
      this.world.addChild(
        this.gridG, this.floorG, this.zoneLabels, this.linkG, this.linkDashG, this.linkHiG,
        this.nodeLayer, this.labelLayer,
      );
      this.app.stage.addChild(this.world);

      this.build(topology, (kind) => textures[emojiUrl(kind)]!);
      this.bindInput();
      this.app.ticker.add(this.tick);
      this.fit(true);
      // Keep the map framed on window resize until the user takes control of the camera.
      const onResize = () => !this.userMoved && this.fit(true);
      this.app.renderer.on("resize", onResize);
      this.disposers.push(() => this.app.renderer.off("resize", onResize));
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
    this.drawLinks(t);
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
    }
  }

  private anchorOf(n: NetNode): Pt {
    const c = tileCentre(n.pos.x, n.pos.y);
    return { x: c.x, y: c.y - LINK_ANCHOR_LIFT };
  }

  private drawLinks(t: Topology): void {
    const byId = new Map(t.nodes.map((n) => [n.id, n]));
    for (const l of t.links) {
      const a = byId.get(l.a);
      const b = byId.get(l.b);
      if (!a || !b) continue;
      const c = linkCurve(this.anchorOf(a), this.anchorOf(b));
      this.curves.set(l.id, c);
      const style = MEDIUM_STYLE[l.medium];
      const g = style.dashed ? this.linkDashG : this.linkG;
      g.moveTo(c.p0.x, c.p0.y)
        .bezierCurveTo(c.c1.x, c.c1.y, c.c2.x, c.c2.y, c.p3.x, c.p3.y)
        .stroke({ width: style.width, color: COLORS.link, alpha: 0.55, pixelLine: true });
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
    sprite.setSize(art.size);
    sprite.eventMode = "static";
    sprite.cursor = "pointer";
    sprite.on("pointerover", () => !this.drag && this.events.onHover(n.id));
    sprite.on("pointerout", () => this.events.onHover(null));
    sprite.on("pointertap", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      if (!this.dragMoved) this.events.onSelect(n.id);
    });
    body.addChild(sprite);

    if (n.status !== "online") {
      const dot = new Graphics().circle(0, 0, 5).fill(STATUS_COLORS[n.status]).stroke({ width: 2, color: 0xffffff });
      dot.position.set(art.size * 0.34, -art.size * 0.82);
      body.addChild(dot);
    }

    root.addChild(ring, shadow, body);
    this.nodeLayer.addChild(root);

    const label = this.makeLabel(n.label);
    label.position.set(c.x, c.y + 13);
    this.labelLayer.addChild(label);

    this.views.set(n.id, { node: n, root, body, shadow, ring, label, lift: 0, ringAlpha: 0, alpha: 1 });
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

  // ── Focus / highlight ─────────────────────────────────────────────────────

  private refreshFocus(): void {
    const t = this.topology;
    if (!t) return;
    this.related.clear();
    const hi = this.linkHiG.clear();
    const draw = (id: string, alpha: number, width: number) => {
      for (const l of t.links) {
        if (l.a !== id && l.b !== id) continue;
        this.related.add(l.a).add(l.b);
        const c = this.curves.get(l.id);
        if (!c) continue;
        hi.moveTo(c.p0.x, c.p0.y)
          .bezierCurveTo(c.c1.x, c.c1.y, c.c2.x, c.c2.y, c.p3.x, c.p3.y)
          .stroke({ width, color: COLORS.accent, alpha, pixelLine: true });
      }
    };
    if (this.hovered && this.hovered !== this.selected) draw(this.hovered, 0.45, 1.75);
    if (this.selected) draw(this.selected, 0.95, 2.25);
    const dim = this.selected !== null;
    this.linkG.alpha = dim ? 0.4 : 1;
    this.linkDashG.alpha = dim ? 0.4 : 1;
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

    const ease = 1 - Math.exp(-dt / 70);
    const labelZoomAlpha = clamp((this.cam.s - 0.5) / 0.2, 0, 1);
    for (const [id, v] of this.views) {
      const isSel = id === this.selected;
      const isHover = id === this.hovered;
      const lit = !this.selected || isSel || this.related.has(id);

      v.lift += ((isSel || isHover ? -6 : 0) - v.lift) * ease;
      v.body.y = v.lift;
      v.shadow.scale.set(1 + v.lift * 0.02);

      v.ringAlpha += ((isSel ? 1 : 0) - v.ringAlpha) * ease;
      v.ring.alpha = v.ringAlpha;
      if (isSel) v.ring.scale.set(1 + Math.sin(this.time * 3) * 0.035);

      v.alpha += ((lit ? 1 : 0.35) - v.alpha) * ease;
      v.root.alpha = v.alpha;
      v.label.alpha = isSel || isHover ? 1 : v.alpha * labelZoomAlpha;
    }
  };
}
