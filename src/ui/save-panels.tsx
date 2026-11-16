/**
 * Phase 7 UI: undo/redo buttons, the Saves sheet (named saves, daily autosaves, share codes)
 * and a small notice toast ("Autosaved · Tue 00:00").
 */
import { useCallback, useEffect, useState } from "react";
import { describeSave, type SaveFile } from "../engine/save/save";
import { AUTOSAVE_KEEP, deleteSave, listSaves, newSaveId, putSave, type SaveRecord } from "../persist/db";
import { decodeShareCode, encodeShareCode } from "../persist/share";
import { sim, useSim } from "../state/sim";
import { useApp } from "../state/store";
import { H, Modal, card, primary } from "./game-panels";

const quiet =
  "h-7 rounded-[8px] bg-black/[0.05] px-2.5 text-[12px] font-medium text-ink-2 hover:bg-black/[0.08] hover:text-ink disabled:opacity-40";

// ── Undo / redo ──────────────────────────────────────────────────────────────

export function HistoryButtons() {
  const h = useSim((s) => s.snap?.history);
  useHistoryKeys();
  const tip = (verb: string, label: string | null | undefined) =>
    h?.locked ? `Games are final: ${verb.toLowerCase()} is off until the game ends` : label ? `${verb}: ${label}` : `Nothing to ${verb.toLowerCase()}`;
  const btn =
    "flex h-7 w-7 items-center justify-center rounded-[8px] text-[15px] text-ink-2 hover:bg-black/[0.06] hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <div className="flex items-center">
      <button className={btn} disabled={!h?.undo || h.locked} title={tip("Undo", h?.undo)} aria-label={tip("Undo", h?.undo)} onClick={() => void sim.undo()}>
        ↶
      </button>
      <button className={btn} disabled={!h?.redo || h.locked} title={tip("Redo", h?.redo)} aria-label={tip("Redo", h?.redo)} onClick={() => void sim.redo()}>
        ↷
      </button>
    </div>
  );
}

/** ⌘/Ctrl+Z undo, ⌘/Ctrl+Shift+Z or Ctrl+Y redo (not while typing). */
function useHistoryKeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        void sim.undo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        void sim.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

// ── Notice toast ─────────────────────────────────────────────────────────────

export function NoticeToast() {
  const notice = useSim((s) => s.notice);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => sim.clearNotice(), 3500);
    return () => clearTimeout(t);
  }, [notice]);
  if (!notice) return null;
  return (
    <div role="status" className="glass absolute top-[72px] left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-[12px] font-medium text-ink">
      ✓ {notice}
    </div>
  );
}

// ── Saves sheet ──────────────────────────────────────────────────────────────

const savedAt = (ms: number) => new Date(ms).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

async function copyCode(save: SaveFile, show: (code: string) => void): Promise<void> {
  const code = await encodeShareCode(save);
  show(code);
  try {
    await navigator.clipboard.writeText(code);
    sim.notify(`Share code copied (${code.length.toLocaleString()} characters)`);
  } catch {
    sim.notify("Couldn't reach the clipboard: copy the code from the box below");
  }
}

export function SavesSheet() {
  const open = useApp((s) => s.savesOpen);
  const setOpen = useApp((s) => s.setSavesOpen);
  const loadSave = useApp((s) => s.loadSave);
  const meta = useApp((s) => s.topology.meta);
  const version = useSim((s) => s.savesVersion);
  const [records, setRecords] = useState<SaveRecord[] | null>(null);
  const [name, setName] = useState("");
  const [paste, setPaste] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    listSaves()
      .then((r) => live && setRecords(r))
      .catch((e: unknown) => live && setProblem(`Browser storage is unavailable: ${String(e)}`));
    return () => {
      live = false;
    };
  }, [open, version]);

  // Reset the form when the sheet opens (not as the clock runs, so typing isn't overwritten).
  useEffect(() => {
    if (!open) return;
    setName("");
    setCode(null);
    setConfirm(null);
    setProblem(null);
    setPaste("");
  }, [open]);

  const close = useCallback(() => setOpen(false), [setOpen]);
  if (!open) return null;

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await fn();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveNow = () =>
    guard(async () => {
      const save = await sim.exportSave();
      if (!save) throw new Error("Nothing to save yet");
      // Default name: the business and the simulated time the save was actually taken.
      const summary = describeSave(save);
      const label = name.trim() || `${meta.name} · ${summary.when}`;
      await putSave({ id: newSaveId("named"), kind: "named", name: label, createdAt: Date.now(), summary, save });
      setName("");
      sim.savesChanged();
      sim.notify(`Saved “${label}”`);
    });

  const load = (save: unknown, label: string) =>
    guard(async () => {
      const err = await loadSave(save);
      if (err) throw new Error(err);
      sim.notify(`Loaded ${label}`);
    });

  const named = records?.filter((r) => r.kind === "named") ?? [];
  const autos = records?.filter((r) => r.kind === "auto") ?? [];

  const row = (r: SaveRecord) => (
    <li key={r.id} className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{r.name}</p>
        <p className="truncate text-[11px] text-ink-3">
          {r.summary.business} · {r.summary.when} (day {r.summary.day + 1}) · {r.summary.mode} · saved {savedAt(r.createdAt)}
        </p>
      </div>
      {confirm === r.id ? (
        <>
          <span className="text-[11px] text-ink-2">Replace the current session?</span>
          <button className={primary} disabled={busy} onClick={() => void load(r.save, r.name)}>
            Load
          </button>
          <button className={quiet} onClick={() => setConfirm(null)}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <button className={quiet} disabled={busy} onClick={() => setConfirm(r.id)}>
            Load
          </button>
          <button className={quiet} disabled={busy} onClick={() => void guard(() => copyCode(r.save, setCode))}>
            Copy code
          </button>
          <button
            className={quiet}
            disabled={busy}
            aria-label={`Delete ${r.name}`}
            onClick={() =>
              void guard(async () => {
                await deleteSave(r.id);
                sim.savesChanged();
              })
            }
          >
            Delete
          </button>
        </>
      )}
    </li>
  );

  return (
    <Modal title="Saves" icon="/emoji/database.png" onClose={close}>
      {problem && <p className="mb-2 rounded-[10px] bg-bad/10 px-3 py-2 text-[12px] text-[#a8000f]">{problem}</p>}

      <H>This session</H>
      <div className={`${card} flex flex-wrap items-center gap-2`}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void saveNow()}
          aria-label="Save name"
          placeholder={`Name (optional, defaults to ${meta.name} and the current time)`}
          maxLength={80}
          className="h-8 min-w-[220px] flex-1 rounded-[8px] bg-white px-2.5 text-[13px] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.15)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--color-accent)]"
        />
        <button className={primary} disabled={busy} onClick={() => void saveNow()}>
          Save
        </button>
        <button
          className={quiet}
          disabled={busy}
          onClick={() =>
            void guard(async () => {
              const save = await sim.exportSave();
              if (save) await copyCode(save, setCode);
            })
          }
        >
          Copy share code
        </button>
      </div>
      {code && (
        <div className="mt-2">
          <p className="mb-1 text-[11px] text-ink-3">
            Share code ({code.length.toLocaleString()} characters). Anyone can paste it below to open this exact moment.
          </p>
          <textarea
            readOnly
            value={code}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Share code"
            className="h-16 w-full resize-none rounded-[10px] bg-white/80 p-2 font-mono text-[10px] leading-snug text-ink-2 shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.12)] outline-none"
          />
        </div>
      )}

      <H>Open a share code</H>
      <div className={`${card} flex items-start gap-2`}>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder="Paste a code starting HONEYPOT1-"
          aria-label="Paste a share code"
          className="h-14 flex-1 resize-none rounded-[8px] bg-white p-2 font-mono text-[11px] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.15)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--color-accent)]"
        />
        <button
          className={primary}
          disabled={busy || !paste.trim()}
          onClick={() =>
            void guard(async () => {
              const save = await decodeShareCode(paste);
              const err = await loadSave(save);
              if (err) throw new Error(err);
              sim.notify(`Opened ${describeSave(save).business} from a share code`);
            })
          }
        >
          Open
        </button>
      </div>

      <H>Your saves</H>
      <div className={card}>
        {records === null ? (
          <p className="py-2 text-[12px] text-ink-3">Loading…</p>
        ) : named.length ? (
          <ul className="divide-y divide-hairline">{named.map(row)}</ul>
        ) : (
          <p className="py-2 text-[12px] text-ink-3">No saves yet. Name this session above and press Save.</p>
        )}
      </div>

      <H>Autosaves</H>
      <p className="-mt-1 mb-2 text-[11px] text-ink-3">
        Made automatically at the start of each simulated day (midnight). The newest {AUTOSAVE_KEEP} are kept.
      </p>
      <div className={card}>
        {autos.length ? (
          <ul className="divide-y divide-hairline">{autos.map(row)}</ul>
        ) : (
          <p className="py-2 text-[12px] text-ink-3">None yet. The first one appears when the clock passes midnight.</p>
        )}
      </div>
    </Modal>
  );
}
