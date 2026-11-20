/**
 * The few Node APIs the tests use (reading styles.css as text, since Vitest stubs CSS imports;
 * reading and re-recording the generator golden hashes). Declared here because the app is typed
 * without @types/node.
 */
declare module "node:fs" {
  export function readFileSync(path: URL, encoding: "utf8"): string;
  export function writeFileSync(path: URL, data: string): void;
}

declare module "node:crypto" {
  interface Hash {
    update(data: string): Hash;
    digest(encoding: "hex"): string;
  }
  export function createHash(algorithm: "sha256"): Hash;
}

declare const process: { env: Record<string, string | undefined> };

declare module "node:fs" {
  export function readFileSync(path: URL): Uint8Array<ArrayBuffer>;
  export function existsSync(path: URL): boolean;
}
