/**
 * WCAG 2.2 AA guard for the design tokens (build.md §4, Phase 8). Reads the real values from
 * styles.css for both themes, so a token change that breaks contrast fails the build.
 *   text:      ≥ 4.5:1 (1.4.3) on every surface it can sit on, including its own status tint
 *   graphics:  ≥ 3:1   (1.4.11) for status dots, fills and the focus ring
 * Also forbids raw colours in components, which would not follow the theme.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import app from "../App.tsx?raw";

// Vitest stubs CSS imports (even ?raw), so read the stylesheet from disk.
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

const components = import.meta.glob<string>("./*.tsx", { query: "?raw", import: "default", eager: true });

function block(re: RegExp): Record<string, string> {
  const body = re.exec(css)?.[1];
  if (!body) throw new Error(`token block not found: ${re}`);
  return Object.fromEntries([...body.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!]));
}
const LIGHT = block(/@theme\s*{([^}]*)}/);
const DARK = { ...LIGHT, ...block(/:root\[data-theme="dark"\]\s*{([^}]*)}/) };
const SYSTEM_DARK = { ...LIGHT, ...block(/:root:not\(\[data-theme="light"\]\)\s*{([^}]*)}/) };

type RGB = [number, number, number];
const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: RGB, b: RGB) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};
/** `fg` at `alpha` over `bg` (how Tailwind's bg-ok/12 tints render). */
const over = (fg: RGB, alpha: number, bg: RGB): RGB => fg.map((c, i) => c * alpha + bg[i]! * (1 - alpha)) as RGB;

const STATUS = ["ok", "warn", "bad", "pwned", "caution", "accent"] as const;
const TEXT = ["ink", "ink-2", "ink-3", ...STATUS.map((s) => `${s}-ink`)];
const SURFACES = ["surface", "surface-2", "page", "canvas"];

for (const [name, t] of [["light", LIGHT], ["dark", DARK]] as const) {
  describe(`${name} theme meets WCAG 2.2 AA`, () => {
    const c = (k: string) => {
      const v = t[k];
      if (!v) throw new Error(`missing token ${k}`);
      return rgb(v);
    };

    it("body text, secondary text and status text on every surface (≥ 4.5:1)", () => {
      const fails: string[] = [];
      for (const fg of TEXT) for (const bg of SURFACES) if (ratio(c(fg), c(bg)) < 4.5) fails.push(`${fg} on ${bg}: ${ratio(c(fg), c(bg)).toFixed(2)}`);
      expect(fails).toEqual([]);
    });

    it("status text on its own tinted badge (≥ 4.5:1)", () => {
      const fails: string[] = [];
      for (const s of STATUS) {
        for (const a of [0.1, 0.12, 0.15, 0.2]) {
          const bg = over(c(s), a, c("surface"));
          const r = ratio(c(`${s}-ink`), bg);
          if (r < 4.5) fails.push(`${s}-ink on ${s}/${a}: ${r.toFixed(2)}`);
        }
      }
      expect(fails).toEqual([]);
    });

    it("white text on accent and danger buttons, including hover (≥ 4.5:1)", () => {
      const white = rgb("#ffffff");
      for (const bg of ["accent", "accent-hover", "bad"]) expect(ratio(white, c(bg)), bg).toBeGreaterThanOrEqual(4.5);
    });

    it("status dots, fills and the focus ring stand out from surfaces (≥ 3:1)", () => {
      const fails: string[] = [];
      for (const s of ["ok", "warn", "bad", "pwned", "accent"]) {
        for (const bg of ["surface", "page"]) if (ratio(c(s), c(bg)) < 3) fails.push(`${s} on ${bg}: ${ratio(c(s), c(bg)).toFixed(2)}`);
      }
      expect(fails).toEqual([]);
    });
  });
}

describe("theme plumbing", () => {
  it("the system-dark and forced-dark blocks define identical values", () => {
    expect(SYSTEM_DARK).toEqual(DARK);
  });

  it("components use theme tokens, not raw colours that ignore dark mode", () => {
    const offenders: string[] = [];
    const sources = [...Object.entries(components), ["App.tsx", app] as const];
    expect(sources.length).toBeGreaterThanOrEqual(8); // every ui/*.tsx plus App.tsx
    for (const [f, src] of sources) {
      for (const m of src.matchAll(/\b(?:bg|text|from|to|border)-(?:white|black)\b(?!\/75)|(?:text|bg|border)-\[#[0-9a-f]{3,6}\]/gi)) {
        // White text is allowed only on accent/danger fills (checked above).
        if (m[0] === "text-white") continue;
        offenders.push(`${f}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
