/**
 * UI for the optional Honeypot API: opening `?share=` links, copying share links, submitting a
 * finished scenario to its leaderboard and showing the top scores. Every piece renders nothing
 * when the build has no `VITE_API_URL` (see src/persist/api.ts).
 */
import { useEffect, useState } from "react";
import { INDUSTRY_INFO } from "../engine/gen/spec";
import type { GameView } from "../engine/incidents/engine";
import type { SaveFile } from "../engine/save/save";
import { INDUSTRIES, type Industry } from "../engine/model";
import {
  PLAYER_MAX, api, clearShareFromUrl, rememberPlayerName, savedPlayerName, shareIdFromUrl, shareLink,
  type ScoreAccepted, type ScoreRow,
} from "../persist/api";
import { sim, useSim } from "../state/sim";
import { useApp } from "../state/store";
import { card, primary } from "./game-panels";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isIndustry = (v: unknown): v is Industry => typeof v === "string" && (INDUSTRIES as readonly string[]).includes(v);

// ── Share links ──────────────────────────────────────────────────────────────

/** Resolves once the simulation has sent its first snapshot. */
function simulationReady(): Promise<void> {
  if (useSim.getState().snap) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = useSim.subscribe((s) => {
      if (!s.snap) return;
      stop();
      resolve();
    });
  });
}

/**
 * Opens the business in `?share=<id>` once at start-up, then removes the parameter. A failure
 * stays on screen until dismissed (the shared command-error toast is cleared by the next command).
 */
export function SharedLinkOpener() {
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const id = shareIdFromUrl();
    if (!id) return;
    if (!api) {
      clearShareFromUrl();
      setProblem("This copy of Honeypot isn't connected to a server, so it can't open share links.");
      return;
    }
    let live = true;
    void (async () => {
      try {
        // Let the start-up simulation finish booting first, so it can't replace the shared business.
        await simulationReady();
        const { businessName, save } = await api.fetchShare(id);
        if (!live) return;
        const err = await useApp.getState().loadSave(save);
        if (err) throw new Error(`The shared save couldn't be opened: ${err}`);
        sim.notify(`Opened ${businessName} from a share link`);
      } catch (e) {
        if (live) setProblem(errorText(e));
      } finally {
        clearShareFromUrl();
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  if (!problem) return null;
  return (
    <div
      role="alert"
      className="glass absolute top-[var(--top,72px)] left-1/2 z-50 flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-3 rounded-[14px] px-4 py-2 text-[12px] font-medium text-bad-ink"
    >
      <span>Share link: {problem}</span>
      <button
        onClick={() => setProblem(null)}
        aria-label="Dismiss"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-fill/[0.06] text-ink-2 hover:bg-fill/[0.1]"
      >
        ✕
      </button>
    </div>
  );
}

/** Publishes a save and copies its link. Shows the link in `show` if the clipboard is unavailable. */
export async function copyShareLink(save: SaveFile, show: (link: string) => void): Promise<void> {
  if (!api) return;
  const { id, expiresDays } = await api.createShare(save);
  const link = shareLink(id);
  show(link);
  try {
    await navigator.clipboard.writeText(link);
    sim.notify(`Share link copied · works for ${expiresDays} days`);
  } catch {
    sim.notify("Couldn't reach the clipboard: copy the link from the box below");
  }
}

// ── Leaderboard ──────────────────────────────────────────────────────────────

/** Top scores for one scenario. `refresh` changes reload it (e.g. after a submission). */
export function Leaderboard({ scenarioId, highlight, refresh = 0 }: { scenarioId: string; highlight?: number; refresh?: number }) {
  const [rows, setRows] = useState<ScoreRow[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    let live = true;
    setProblem(null);
    api
      .leaderboard(scenarioId)
      .then((r) => live && setRows(r))
      .catch((e: unknown) => live && setProblem(errorText(e)));
    return () => {
      live = false;
    };
  }, [scenarioId, refresh]);

  if (!api) return null;
  if (problem) return <p className="py-1 text-[12px] text-bad-ink">{problem}</p>;
  if (!rows) return <p className="py-1 text-[12px] text-ink-3">Loading top scores…</p>;
  if (!rows.length) return <p className="py-1 text-[12px] text-ink-3">No scores yet. Be the first.</p>;
  return (
    <table className="w-full text-[12px] tabular-nums">
      <caption className="sr-only">Top scores</caption>
      <thead className="text-left text-[10px] uppercase tracking-[0.06em] text-ink-3">
        <tr>
          <th scope="col" className="py-1 pr-2 font-semibold">#</th>
          <th scope="col" className="py-1 pr-2 font-semibold">Player</th>
          <th scope="col" className="hidden py-1 pr-2 font-semibold sm:table-cell">Business</th>
          <th scope="col" className="py-1 pr-2 text-right font-semibold">Score</th>
          <th scope="col" className="py-1 text-right font-semibold">Grade</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-hairline">
        {rows.map((r) => (
          <tr key={`${r.rank}-${r.created_at}`} className={r.rank === highlight ? "bg-accent/10 font-semibold" : ""}>
            <td className="py-1 pr-2 text-ink-3">{r.rank}</td>
            <td className="max-w-[10rem] truncate py-1 pr-2">{r.player}</td>
            <td className="hidden py-1 pr-2 text-ink-3 sm:table-cell">{isIndustry(r.industry) ? INDUSTRY_INFO[r.industry].label : r.industry}</td>
            <td className="py-1 pr-2 text-right">{r.score}</td>
            <td className="py-1 text-right">{r.grade}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** "Top scores" toggle for a scenario card in the Play sheet. */
export function ScenarioTopScores({ scenarioId }: { scenarioId: string }) {
  const [open, setOpen] = useState(false);
  if (!api) return null;
  return (
    <div className="mt-2">
      <button className="text-[12px] font-medium text-accent-ink hover:underline" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Hide top scores" : "Top scores"}
      </button>
      {open && (
        <div className="mt-1">
          <Leaderboard scenarioId={scenarioId} />
        </div>
      )}
    </div>
  );
}

// ── Submitting a finished scenario ───────────────────────────────────────────

/** Shown in the after-action report once a scenario has finished. */
export function SubmitScore({ game }: { game: GameView }) {
  const industry = useApp((s) => s.topology.meta.profile?.industry);
  const [player, setPlayer] = useState(savedPlayerName);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<ScoreAccepted | null>(null);
  const scenarioId = game.scenario?.id;

  // A new game resets the form.
  useEffect(() => {
    setAccepted(null);
    setProblem(null);
  }, [scenarioId]);

  if (!api || game.mode !== "scenario" || !game.finished || !scenarioId) return null;
  const client = api;

  if (!industry) {
    return (
      <p className={`${card} text-[12px] text-ink-3`}>
        Leaderboards compare generated businesses, so runs on an imported custom network can't be submitted.
      </p>
    );
  }

  const submit = async () => {
    const name = player.trim();
    if (!name) return;
    setBusy(true);
    setProblem(null);
    try {
      const save = await sim.exportSave();
      if (!save) throw new Error("The simulation isn't ready yet");
      const r = await client.submitScore({ scenarioId, player: name, industry, score: game.score, seed: save.seed, stateHash: save.hash });
      rememberPlayerName(name);
      setAccepted(r);
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={card}>
      {accepted ? (
        <p className="mb-2 text-[13px]" role="status">
          Submitted: you're <b>#{accepted.rank}</b> on {game.scenario?.name} with grade {accepted.grade}.
        </p>
      ) : (
        <form
          className="mb-2 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="leaderboard-name" className="text-[13px]">
            Your name
          </label>
          <input
            id="leaderboard-name"
            name="player"
            value={player}
            onChange={(e) => setPlayer(e.target.value)}
            maxLength={PLAYER_MAX}
            autoComplete="nickname"
            className="h-8 min-w-0 flex-1 rounded-[8px] bg-surface px-2.5 text-[13px] shadow-[inset_0_0_0_0.5px_rgb(var(--shade)/0.15)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--color-accent)]"
          />
          <button type="submit" className={primary} disabled={busy || !player.trim()}>
            {busy ? "Submitting…" : `Submit ${game.score}`}
          </button>
        </form>
      )}
      {problem && (
        <p className="mb-2 text-[12px] text-bad-ink" role="alert">
          {problem}
        </p>
      )}
      <Leaderboard scenarioId={scenarioId} highlight={accepted?.rank} refresh={accepted?.id ?? 0} />
    </div>
  );
}
