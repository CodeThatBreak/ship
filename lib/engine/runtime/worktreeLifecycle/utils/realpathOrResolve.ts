import fs from "fs";
import path from "path";

/**
 * Canonical (realpath) spelling of a path, falling back to the resolved
 * absolute path when the entry does not exist. Worktree paths are stored and
 * compared in canonical form because git canonicalizes worktree paths itself
 * (e.g. /var → /private/var on macOS), and sweep/removal matching joins
 * against `git worktree list` output.
 */
export const realpathOrResolve = (p: string): string => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};
