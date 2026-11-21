/**
 * Client for the optional Honeypot API (`api/`): share links and scenario leaderboards.
 *
 * Off unless the build sets `VITE_API_URL` (e.g. `VITE_API_URL=https://api.example.com`). When it
 * is unset every API feature is hidden and the game stays fully offline, as on the static demo.
 * Responses are validated, so a misbehaving server shows an error instead of corrupting the UI.
 */
import { z } from "zod";
import type { SaveFile } from "../engine/save/save";

const configured = (import.meta.env.VITE_API_URL as string | undefined)?.trim().replace(/\/+$/, "") ?? "";

/** True when this build talks to a backend. */
export const apiEnabled = configured !== "";

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

type Fetch = typeof fetch;

const ShareCreated = z.object({ id: z.string().min(1), expires_days: z.number().int() });
const ShareInfo = z.object({ id: z.string(), business_name: z.string(), save: z.unknown() });
const ScoreAccepted = z.object({ id: z.number().int(), grade: z.string(), rank: z.number().int().positive() });
const ScoreRow = z.object({
  rank: z.number().int(),
  player: z.string(),
  industry: z.string(),
  score: z.number().int(),
  grade: z.string(),
  created_at: z.string(),
});
const Leaderboard = z.array(ScoreRow);

export type ScoreRow = z.infer<typeof ScoreRow>;
export type ScoreAccepted = z.infer<typeof ScoreAccepted>;

export interface ScoreSubmission {
  scenarioId: string;
  player: string;
  industry: string;
  score: number;
  seed: number;
  stateHash: string;
}

/** Share ids are `secrets.token_urlsafe(9)` on the server: 12 URL-safe characters. */
export const SHARE_ID = /^[A-Za-z0-9_-]{8,16}$/;
export const PLAYER_MAX = 24;

/** Turns FastAPI's `{detail}` (a string, or a list of validation errors) into one readable line. */
function detailOf(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("detail" in body)) return null;
  const d = (body as { detail: unknown }).detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    const msgs = d.map((e) => (e && typeof e === "object" && "msg" in e ? String((e as { msg: unknown }).msg) : "")).filter(Boolean);
    if (msgs.length) return msgs.join("; ");
  }
  return null;
}

export function createApiClient(base: string, fetchImpl: Fetch = (...a) => fetch(...a)) {
  async function call<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        ...init,
        headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
      });
    } catch {
      throw new ApiError("Couldn't reach the Honeypot server. Check your connection and try again.");
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON error page: fall through to the status message */
    }
    if (!res.ok) {
      if (res.status === 404) throw new ApiError(detailOf(body) ?? "Not found", 404);
      if (res.status === 413) throw new ApiError("This save is too large to share as a link. Use a share code instead.", 413);
      throw new ApiError(detailOf(body) ?? `Server error (${res.status})`, res.status);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new ApiError("The server sent an unexpected response.");
    return parsed.data;
  }

  return {
    /** Publishes a save; returns its share id. */
    async createShare(save: SaveFile): Promise<{ id: string; expiresDays: number }> {
      const r = await call("/api/shares", ShareCreated, { method: "POST", body: JSON.stringify(save) });
      return { id: r.id, expiresDays: r.expires_days };
    },
    /** Fetches a shared save. The save is returned unvalidated: the engine checks it on load. */
    async fetchShare(id: string): Promise<{ businessName: string; save: unknown }> {
      if (!SHARE_ID.test(id)) throw new ApiError("That share link isn't valid.");
      try {
        const r = await call(`/api/shares/${encodeURIComponent(id)}`, ShareInfo);
        return { businessName: r.business_name, save: r.save };
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) throw new ApiError("This share link has expired or doesn't exist.", 404);
        throw e;
      }
    },
    async submitScore(s: ScoreSubmission): Promise<ScoreAccepted> {
      const body = {
        scenario_id: s.scenarioId,
        player: s.player.trim().slice(0, PLAYER_MAX),
        industry: s.industry,
        score: s.score,
        seed: s.seed,
        state_hash: s.stateHash,
      };
      return call("/api/scores", ScoreAccepted, { method: "POST", body: JSON.stringify(body) });
    },
    async leaderboard(scenarioId: string, limit = 10): Promise<ScoreRow[]> {
      return call(`/api/scenarios/${encodeURIComponent(scenarioId)}/leaderboard?limit=${limit}`, Leaderboard);
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** The client for this build, or null when no backend is configured. */
export const api: ApiClient | null = apiEnabled ? createApiClient(configured) : null;

// ── Share links ──────────────────────────────────────────────────────────────

const SHARE_PARAM = "share";

/** The game's own URL with `?share=<id>`, e.g. https://you.github.io/HoneyPot/?share=abc. */
export function shareLink(id: string, loc: Pick<Location, "origin" | "pathname"> = location): string {
  const url = new URL(loc.pathname, loc.origin);
  url.searchParams.set(SHARE_PARAM, id);
  return url.toString();
}

/** The share id in the page URL, if any. */
export function shareIdFromUrl(search: string = location.search): string | null {
  return new URLSearchParams(search).get(SHARE_PARAM);
}

/** Removes `?share=` from the address bar, so a reload doesn't reopen the share over later work. */
export function clearShareFromUrl(): void {
  const url = new URL(location.href);
  if (!url.searchParams.has(SHARE_PARAM)) return;
  url.searchParams.delete(SHARE_PARAM);
  history.replaceState(history.state, "", url);
}

// ── Player name ──────────────────────────────────────────────────────────────

const PLAYER_KEY = "honeypot.player";

/** Remembered leaderboard name (per browser; storage may be unavailable). */
export function savedPlayerName(): string {
  try {
    return localStorage.getItem(PLAYER_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberPlayerName(name: string): void {
  try {
    localStorage.setItem(PLAYER_KEY, name.trim().slice(0, PLAYER_MAX));
  } catch {
    /* private mode: just don't remember */
  }
}
