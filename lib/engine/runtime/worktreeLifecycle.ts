import "server-only";

import { pinnedProcessService } from "../../composition/processServices";
import { WorktreeManager } from "./worktreeLifecycle/worktreeManager";

/**
 * Process pin for the worktree lifecycle services (decision Q9). The
 * WorktreeManager class and its collaborators live in `worktreeLifecycle/`;
 * this module keeps the pin — the shared engine manager, one instance per
 * process across module graphs — so the import surface (`worktreeManager`)
 * and the pin key are unchanged.
 *
 * Why pinned: `WorktreeManager.ensureInFlight` is an in-memory coalescing
 * mutex — one ensure per flow, shared by every module graph. Per-module-graph
 * copies would race the same worktree path. Durable truth (bindings, removal
 * records) lives in Postgres.
 *
 * Must-never: never move the pin into the class file (class files are pure —
 * classFilePurity arch test); never re-pin under a different key.
 */
export const worktreeManager = pinnedProcessService("worktreeManager", () => new WorktreeManager());
