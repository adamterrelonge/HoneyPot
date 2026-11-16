/**
 * Per-viewer preferences (Phase 8): theme choice, the OS reduced-motion setting and the
 * tutorial's "Don't ask again". Remembered in localStorage when it's available; everything
 * still works when it isn't (private windows, blocked storage).
 */
import { create } from "zustand";

export type ThemePref = "system" | "light" | "dark";
export type Theme = "light" | "dark";

const KEY = { theme: "honeypot.theme", tour: "honeypot.tour.dontAsk" };

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the preference lasts for this visit only */
  }
}

const media = (q: string) => (typeof matchMedia === "function" ? matchMedia(q) : null);
const darkQuery = media("(prefers-color-scheme: dark)");
const motionQuery = media("(prefers-reduced-motion: reduce)");

const storedTheme = read(KEY.theme);
const initialPref: ThemePref = storedTheme === "light" || storedTheme === "dark" ? storedTheme : "system";
const resolve = (pref: ThemePref): Theme => (pref === "system" ? (darkQuery?.matches ? "dark" : "light") : pref);

interface Prefs {
  theme: ThemePref;
  /** The theme actually shown (system choice resolved). */
  resolved: Theme;
  reducedMotion: boolean;
  tourDontAsk: boolean;
  setTheme: (t: ThemePref) => void;
  setTourDontAsk: (v: boolean) => void;
}

/** Light/dark is applied with `data-theme` on <html>; no attribute means "follow the system". */
function apply(pref: ThemePref): void {
  if (typeof document === "undefined") return;
  if (pref === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = pref;
}
apply(initialPref);

export const usePrefs = create<Prefs>()((set) => ({
  theme: initialPref,
  resolved: resolve(initialPref),
  reducedMotion: motionQuery?.matches ?? false,
  tourDontAsk: read(KEY.tour) === "1",
  setTheme: (theme) => {
    write(KEY.theme, theme === "system" ? null : theme);
    apply(theme);
    set({ theme, resolved: resolve(theme) });
  },
  setTourDontAsk: (tourDontAsk) => {
    write(KEY.tour, tourDontAsk ? "1" : null);
    set({ tourDontAsk });
  },
}));

darkQuery?.addEventListener("change", () => usePrefs.setState((s) => ({ resolved: resolve(s.theme) })));
motionQuery?.addEventListener("change", (e) => usePrefs.setState({ reducedMotion: e.matches }));

export const THEME_LABEL: Record<ThemePref, string> = { system: "System", light: "Light", dark: "Dark" };
export const nextTheme = (t: ThemePref): ThemePref => (t === "system" ? "light" : t === "light" ? "dark" : "system");
