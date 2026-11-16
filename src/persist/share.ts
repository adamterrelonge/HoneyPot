/**
 * Share codes (build.md §8 Phase 7): a whole save as one copyable line of text.
 * `HONEYPOT1-` + base64url(deflate(JSON)). Whitespace is ignored when pasting, so codes
 * survive being wrapped by chat apps and email.
 */
import { SaveError, parseSave, type SaveFile } from "../engine/save/save";

export const SHARE_PREFIX = "HONEYPOT1-";

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encodeShareCode(save: SaveFile): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(save));
  return SHARE_PREFIX + toBase64Url(await pipe(json, new CompressionStream("deflate-raw")));
}

/** Decode and validate a pasted share code. Throws SaveError with a readable message. */
export async function decodeShareCode(code: string): Promise<SaveFile> {
  const clean = code.replace(/\s+/g, "");
  if (!clean.startsWith(SHARE_PREFIX)) throw new SaveError("That isn't a Honeypot share code (they start with HONEYPOT1-).");
  let json: unknown;
  try {
    const bytes = await pipe(fromBase64Url(clean.slice(SHARE_PREFIX.length)), new DecompressionStream("deflate-raw"));
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new SaveError("That share code is damaged or incomplete. Copy the whole code and try again.");
  }
  return parseSave(json);
}
