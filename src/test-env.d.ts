/**
 * The one Node API the tests use (reading styles.css as text; Vitest stubs CSS imports).
 * Declared here because the app is typed without @types/node.
 */
declare module "node:fs" {
  export function readFileSync(path: URL, encoding: "utf8"): string;
}
