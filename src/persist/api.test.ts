import { describe, expect, it } from "vitest";
import type { SaveFile } from "../engine/save/save";
import { ApiError, SHARE_ID, apiEnabled, createApiClient, shareIdFromUrl, shareLink } from "./api";

type Call = { url: string; init?: RequestInit };

/** A fetch that records calls and answers with `status` and `body` (or throws for a network error). */
function fakeFetch(status: number, body: unknown, calls: Call[] = []): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (status === 0) throw new TypeError("Failed to fetch");
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
}

const save = { format: "honeypot-save", v: 1, business: { kind: "spec", spec: {} }, seed: 7, hash: "abc", state: {} } as unknown as SaveFile;

describe("api client", () => {
  it("is off in builds without VITE_API_URL", () => {
    expect(apiEnabled).toBe(false);
  });

  it("creates a share with a JSON POST", async () => {
    const calls: Call[] = [];
    const c = createApiClient("https://api.test", fakeFetch(201, { id: "aB3_xY9-kLm2", url: "x", expires_days: 90 }, calls));
    expect(await c.createShare(save)).toEqual({ id: "aB3_xY9-kLm2", expiresDays: 90 });
    expect(calls[0]!.url).toBe("https://api.test/api/shares");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init?.body))).toMatchObject({ format: "honeypot-save", seed: 7 });
    expect((calls[0]!.init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("fetches a share and passes the save through for the engine to validate", async () => {
    const c = createApiClient("https://api.test", fakeFetch(200, { id: "aB3_xY9-kLm2", business_name: "Acme", industry: null, created_at: "2026-11-21T10:00:00Z", save }));
    const r = await c.fetchShare("aB3_xY9-kLm2");
    expect(r.businessName).toBe("Acme");
    expect(r.save).toEqual(save);
  });

  it("rejects malformed share ids without calling the server", async () => {
    const calls: Call[] = [];
    const c = createApiClient("https://api.test", fakeFetch(200, {}, calls));
    await expect(c.fetchShare("../../etc")).rejects.toThrow("isn't valid");
    expect(calls).toHaveLength(0);
    expect(SHARE_ID.test("aB3_xY9-kLm2")).toBe(true);
  });

  it("explains expired shares, oversized saves and network failures", async () => {
    await expect(createApiClient("x", fakeFetch(404, { detail: "Share not found or expired" })).fetchShare("aB3_xY9-kLm2")).rejects.toThrow("expired");
    await expect(createApiClient("x", fakeFetch(413, { detail: "too large" })).createShare(save)).rejects.toThrow("share code instead");
    await expect(createApiClient("x", fakeFetch(0, null)).leaderboard("payroll-friday")).rejects.toThrow("Couldn't reach");
  });

  it("surfaces FastAPI validation messages", async () => {
    const body = { detail: [{ msg: "Value error, player name must be printable text" }] };
    const err = await createApiClient("x", fakeFetch(422, body))
      .submitScore({ scenarioId: "s", player: "x", industry: "retail", score: 1, seed: 1, stateHash: "h" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
    expect((err as ApiError).message).toBe("Value error, player name must be printable text");
  });

  it("rejects responses that don't match the expected shape", async () => {
    await expect(createApiClient("x", fakeFetch(200, [{ rank: "first" }])).leaderboard("s")).rejects.toThrow("unexpected response");
    await expect(createApiClient("x", fakeFetch(500, "<html>")).leaderboard("s")).rejects.toThrow("Server error (500)");
  });

  it("submits scores in the server's field names, trimming the player name", async () => {
    const calls: Call[] = [];
    const c = createApiClient("https://api.test", fakeFetch(201, { id: 4, grade: "B", rank: 2 }, calls));
    const r = await c.submitScore({ scenarioId: "payroll-friday", player: "  Sam  ", industry: "retail", score: 812, seed: 12345, stateHash: "h1" });
    expect(r).toEqual({ id: 4, grade: "B", rank: 2 });
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      scenario_id: "payroll-friday", player: "Sam", industry: "retail", score: 812, seed: 12345, state_hash: "h1",
    });
  });

  it("asks for a scenario's leaderboard", async () => {
    const calls: Call[] = [];
    const row = { rank: 1, player: "Sam", industry: "retail", score: 900, grade: "A", created_at: "2026-11-21T10:00:00Z" };
    const rows = await createApiClient("https://api.test", fakeFetch(200, [row], calls)).leaderboard("payroll-friday");
    expect(rows).toEqual([row]);
    expect(calls[0]!.url).toBe("https://api.test/api/scenarios/payroll-friday/leaderboard?limit=10");
  });
});

describe("share links", () => {
  it("point at the game itself, keeping the deploy path", () => {
    expect(shareLink("aB3_xY9-kLm2", { origin: "https://adamterrelonge.github.io", pathname: "/HoneyPot/" })).toBe(
      "https://adamterrelonge.github.io/HoneyPot/?share=aB3_xY9-kLm2",
    );
  });

  it("are read back from the query string", () => {
    expect(shareIdFromUrl("?share=aB3_xY9-kLm2&x=1")).toBe("aB3_xY9-kLm2");
    expect(shareIdFromUrl("")).toBeNull();
  });
});
