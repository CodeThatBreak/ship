import "server-only";

import path from "path";
import { config } from "../config";

/**
 * Canonical paths under the DevFlow workspace root. Clone mirrors and agent
 * worktrees must never share a directory — they use different `.git` layouts.
 */
export class WorkspacePaths {
  constructor(private readonly root: string = config.workspace.dir()) {}

  /** Full clone used for cloud diffs and merge-arena side clones (`workspaces/clones/<id>`). */
  cloneDir = (flowId: string): string => path.join(this.root, "clones", flowId);

  /** Linked worktree for local agent runs (`workspaces/worktrees/<id>`). */
  worktreeDir = (flowId: string): string => path.join(this.root, "worktrees", flowId);

  /** Dedicated merge-back checkout (`workspaces/arenas/<parentFlowId>`). */
  mergeArenaDir = (parentFlowId: string): string => path.join(this.root, "arenas", parentFlowId);

  /** Top-level segment that holds flow worktrees (for sweep / containment checks). */
  worktreesRoot = (): string => path.join(this.root, "worktrees");
}

export const workspacePaths = new WorkspacePaths();
