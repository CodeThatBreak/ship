import "server-only";

import type { ChangeRequestDiffRefs } from "../../engine/ports/gitHost";

export type GitLabDiscussionPositionPayload = {
  base_sha: string;
  start_sha: string;
  head_sha: string;
  position_type: "text";
  old_path: string;
  new_path: string;
  new_line: number;
};

type DiffChangePaths = { oldPath: string; newPath: string };

/**
 * Map a review finding (file + line on the MR head) to GitLab's discussion
 * position object. Returns null when the path is not in the MR diff or refs
 * are incomplete.
 */
export const buildDiscussionPosition = (
  file: string,
  line: number,
  diffRefs: ChangeRequestDiffRefs,
  changes: readonly DiffChangePaths[],
): GitLabDiscussionPositionPayload | null => {
  const trimmed = file.trim();
  if (!trimmed || line < 1) return null;
  if (!diffRefs.baseSha || !diffRefs.startSha || !diffRefs.headSha) return null;

  const entry =
    changes.find((c) => c.newPath === trimmed) ??
    changes.find((c) => c.oldPath === trimmed);
  if (!entry) return null;

  const newPath = entry.newPath;
  if (!newPath || newPath === "/dev/null") return null;

  return {
    base_sha: diffRefs.baseSha,
    start_sha: diffRefs.startSha,
    head_sha: diffRefs.headSha,
    position_type: "text",
    old_path: entry.oldPath,
    new_path: newPath,
    new_line: line,
  };
};
