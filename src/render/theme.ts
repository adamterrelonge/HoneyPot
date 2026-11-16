/** Visual tokens for the canvas (mirrors CSS tokens in styles.css; see build.md §4). */
import type { LinkMedium, NodeKind, NodeStatus, ZoneKind } from "../engine/model";
import type { AppCategory } from "../engine/sim/types";

export const FONT_STACK = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter Variable", system-ui, sans-serif';

export const COLORS = {
  ink: 0x1d1d1f,
  ink2: 0x6e6e73,
  ink3: 0x86868b,
  hairline: 0x000000,
  link: 0x8e8e93,
  accent: 0x0071e3,
  shadow: 0x1d1d1f,
} as const;

export const STATUS_COLORS: Record<NodeStatus, number> = {
  online: 0x34c759,
  degraded: 0xff9f0a,
  offline: 0xff3b30,
  compromised: 0xaf52de,
};

/** Floor plate top colour, side colour and outline per zone kind. */
export const ZONE_STYLE: Record<ZoneKind, { top: number; side: number; edge: number }> = {
  internet: { top: 0xeef5ff, side: 0xd9e7fb, edge: 0xb8cff0 },
  edge: { top: 0xfff3ea, side: 0xf6e0cf, edge: 0xeac8ad },
  server: { top: 0xf3f0ff, side: 0xe2dcf7, edge: 0xc9bff0 },
  office: { top: 0xeefaf1, side: 0xd8efdf, edge: 0xb6dfc2 },
  branch: { top: 0xfbf6ea, side: 0xefe5cc, edge: 0xdfcfa6 },
  cloud: { top: 0xedf8fd, side: 0xd5ecf6, edge: 0xb0daec },
  guest: { top: 0xf6f6f8, side: 0xe6e6ea, edge: 0xcfcfd6 },
  factory: { top: 0xf1f3f6, side: 0xdde1e8, edge: 0xbcc4d1 },
  clinical: { top: 0xfdf0f3, side: 0xf5dbe1, edge: 0xebbcc7 },
  secure: { top: 0xfff8e6, side: 0xf6e9c4, edge: 0xe8d18e },
};

// ── Light and dark palettes for the canvas (Phase 8) ─────────────────────────

export interface Palette {
  ink: number;
  ink3: number;
  hairline: number;
  /** Strength of the floor grid lines. */
  gridAlpha: number;
  link: number;
  accent: number;
  shadow: number;
  /** Multiplier for ground shadows (stronger on dark floors). */
  shadowAlpha: number;
  /** Label pills and dot outlines. */
  surface: number;
  /** Count badge behind group numbers. */
  badge: number;
  status: Record<NodeStatus, number>;
  categories: Record<AppCategory, number>;
  zones: Record<ZoneKind, { top: number; side: number; edge: number }>;
}

/** Each zone's hue, used to tint dark floor plates. */
const ZONE_HUE: Record<ZoneKind, number> = {
  internet: 0x0a84ff, edge: 0xff9f0a, server: 0xbf5af2, office: 0x30d158, branch: 0xffd60a,
  cloud: 0x64d2ff, guest: 0x8e8e93, factory: 0x98a2b3, clinical: 0xff6482, secure: 0xffcc00,
};

/** Linear mix of two 0xRRGGBB colours. */
export function mix(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 0xff;
  const m = (s: number) => Math.round(ch(a, s) * (1 - t) + ch(b, s) * t) << s;
  return m(16) | m(8) | m(0);
}

const DARK_BASE = 0x1c1c1e;
const DARK_ZONES = Object.fromEntries(
  Object.entries(ZONE_HUE).map(([k, hue]) => [
    k,
    { top: mix(DARK_BASE, hue, 0.13), side: mix(0x111113, hue, 0.08), edge: mix(DARK_BASE, hue, 0.45) },
  ]),
) as Palette["zones"];

export const PALETTES: Record<"light" | "dark", Palette> = {
  light: {
    ink: COLORS.ink, ink3: 0x68686d, hairline: COLORS.hairline, gridAlpha: 0.045, link: COLORS.link, accent: COLORS.accent,
    shadow: COLORS.shadow, shadowAlpha: 1, surface: 0xffffff, badge: COLORS.ink,
    status: STATUS_COLORS,
    categories: { work: 0x0071e3, external: 0x5856d6, voice: 0x34c759, system: 0x30b0c7, threat: 0xff3b30 },
    zones: ZONE_STYLE,
  },
  dark: {
    ink: 0xf5f5f7, ink3: 0xa1a1a6, hairline: 0xffffff, gridAlpha: 0.06, link: 0x8e8e93, accent: 0x4da3ff,
    shadow: 0x000000, shadowAlpha: 1.6, surface: 0x2c2c2e, badge: 0x48484a,
    status: { online: 0x30d158, degraded: 0xff9f0a, offline: 0xff453a, compromised: 0xbf5af2 },
    categories: { work: 0x0a84ff, external: 0x7d7aff, voice: 0x30d158, system: 0x64d2ff, threat: 0xff453a },
    zones: DARK_ZONES,
  },
};

export const MEDIUM_STYLE: Record<LinkMedium, { width: number; dashed: boolean }> = {
  fiber: { width: 1.75, dashed: false },
  copper: { width: 1.25, dashed: false },
  wan: { width: 2, dashed: false },
  wifi: { width: 1.25, dashed: true },
  vpn: { width: 1.5, dashed: true },
};

/** Fluent Emoji 3D asset (public/emoji, MIT) + on-canvas size in px + the unicode glyph for text UIs. */
export const NODE_ART: Record<NodeKind, { file: string; size: number; glyph: string }> = {
  internet: { file: "internet", size: 76, glyph: "🌐" },
  isp: { file: "isp", size: 60, glyph: "📡" },
  router: { file: "router", size: 56, glyph: "🔀" },
  firewall: { file: "firewall", size: 64, glyph: "🧱" },
  switch: { file: "switch", size: 58, glyph: "🎛️" },
  wifi: { file: "wifi", size: 54, glyph: "📶" },
  server: { file: "server", size: 62, glyph: "🗄️" },
  database: { file: "database", size: 60, glyph: "🗃️" },
  nas: { file: "nas", size: 54, glyph: "💽" },
  desktop: { file: "desktop", size: 56, glyph: "🖥️" },
  laptop: { file: "laptop", size: 52, glyph: "💻" },
  phone: { file: "phone", size: 46, glyph: "📱" },
  printer: { file: "printer", size: 52, glyph: "🖨️" },
  cloud: { file: "cloud", size: 70, glyph: "☁️" },
  camera: { file: "camera", size: 48, glyph: "📹" },
  voip: { file: "voip", size: 48, glyph: "☎️" },
  pos: { file: "pos", size: 48, glyph: "💳" },
  vpn: { file: "vpn", size: 54, glyph: "🔐" },
  honeypot: { file: "honeypot", size: 54, glyph: "🍯" },
  user: { file: "user", size: 52, glyph: "🧑‍💼" },
  plc: { file: "plc", size: 50, glyph: "⚙️" },
  medical: { file: "medical", size: 52, glyph: "🩻" },
};

export const emojiUrl = (kind: NodeKind) => `/emoji/${NODE_ART[kind].file}.png`;

/** Traffic particle colours by application category (see engine/sim/demands.ts). */
export const CATEGORY_COLORS: Record<AppCategory, number> = {
  work: 0x0071e3,
  external: 0x5856d6,
  voice: 0x34c759,
  system: 0x30b0c7,
  threat: 0xff3b30,
};
