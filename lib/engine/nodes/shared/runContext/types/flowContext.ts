import "server-only";

import type { Repo } from "../../../../../db/app";
import type { FlowRow, Task } from "../../../../../db/rows";
import type { RunMode } from "../../../../../../constants/execution";

export type ExecMode = RunMode;

export interface FlowCtx {
  flow: FlowRow;
  task: Task;
  repo?: Repo | null; // registered repo (when flow.repo_id set / matched)
}
