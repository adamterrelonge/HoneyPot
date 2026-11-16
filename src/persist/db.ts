/**
 * Save slots in IndexedDB (build.md §8 Phase 7). Two kinds share one store:
 *  - named saves, made by the player, kept until deleted;
 *  - autosaves, made at the start of each simulated day, newest AUTOSAVE_KEEP kept.
 * A thin wrapper over the raw IndexedDB API (no library needed for one object store).
 */
import type { SaveFile, SaveSummary } from "../engine/save/save";

export const AUTOSAVE_KEEP = 7;
const DB_NAME = "honeypot";
const STORE = "saves";

export interface SaveRecord {
  id: string;
  kind: "auto" | "named";
  name: string;
  /** Real time saved (epoch ms). */
  createdAt: number;
  summary: SaveSummary;
  save: SaveFile;
}

/** Autosaves beyond the newest `keep` (pure, so it can be tested without a browser). */
export function autosavesToPrune(records: readonly Pick<SaveRecord, "id" | "kind" | "createdAt">[], keep = AUTOSAVE_KEEP): string[] {
  return records
    .filter((r) => r.kind === "auto")
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(keep)
    .map((r) => r.id);
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("Couldn't open browser storage"));
    };
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error ?? new Error("Browser storage error"));
    tx.onabort = () => reject(tx.error ?? new Error("Browser storage is full or unavailable"));
  });
}

/** All saves, newest first. */
export async function listSaves(): Promise<SaveRecord[]> {
  const all = (await run<SaveRecord[]>("readonly", (s) => s.getAll() as IDBRequest<SaveRecord[]>)) ?? [];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function putSave(rec: SaveRecord): Promise<void> {
  await run("readwrite", (s) => s.put(rec));
}

export async function deleteSave(id: string): Promise<void> {
  await run("readwrite", (s) => s.delete(id));
}

/** Store an autosave and drop the oldest beyond AUTOSAVE_KEEP. */
export async function autosave(rec: SaveRecord): Promise<void> {
  await putSave(rec);
  const prune = autosavesToPrune(await listSaves());
  if (prune.length) await run("readwrite", (s) => prune.forEach((id) => s.delete(id)));
}

export const newSaveId = (kind: SaveRecord["kind"]) => `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
