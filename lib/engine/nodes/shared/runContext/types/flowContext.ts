import type { Repo } from "../../../../../db/app";
import type { FlowRow, Task } from "../../../../../db/rows";

export type ExecMode = "cloud" | "local";

export interface FlowCtx {
  flow: FlowRow;
  task: Task;
  repo?: Repo | null; // registered repo (when flow.repo_id set / matched)
}
