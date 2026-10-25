/**
 * Collapse a user-home prefix (`/Users/<name>`, `/home/<name>`) to `~` for
 * display and editing. The API stores the expanded absolute path (it expands
 * `~` against `process.env.HOME` on save — see app/api/repos); we never show
 * the expanded form in the UI.
 */
export function tildePath(p: string): string {
  return p.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}
