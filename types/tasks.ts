/**
 * Client-safe task-workspace types. `LiveTask` re-exports the pure interface
 * from the task-provider module (type-only — erased before bundling) so
 * client components never import `lib/` (AGENTS.md §2.1).
 */
export type { LiveTask } from "@/lib/engine/tasks/task-provider";
import type { LiveTask } from "@/lib/engine/tasks/task-provider";

/** Runtime execution mode of a flow build (settings default + modal pick). */
export type ExecutionMode = "cloud" | "local";

/** One registered task provider as shown in the filter bar's Provider chip. */
export type TaskProviderInfo = {
  kind: string;
  label: string;
  configured: boolean;
};

/** One registered repo, the slice the build modal needs. */
export type RepoSummary = {
  id: string;
  name: string;
  cloud_url: string;
  local_path: string | null;
};

/** One flow template as offered in the build modal's template picker. */
export type TemplateOption = { id: string; name: string };

/** Payload of GET /api/tasks/live (the runtime task feed + cache meta). */
export type LiveTasksPayload = {
  tasks: LiveTask[];
  configured?: boolean;
  provider?: string;
  label?: string;
  /** true when the route served its 60s cache instead of the provider */
  cached: boolean;
  ageSeconds: number;
  ttlSeconds?: number;
  /** set when the route served the cached list after a failed fresh fetch */
  stale?: boolean;
  /** route error (only meaningful with `tasks` present — stale-serve case) */
  error?: string;
};
