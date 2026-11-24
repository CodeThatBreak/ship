"use client";
import type { ReactNode } from "react";
import { FLOW_ACTION } from "@/constants/flow";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PIPELINE_STATUS, pipelineStatusVariant } from "../constants/pipelineStatus";
import type { PanelActionFn } from "../types/artifactRenderer";
import type { PipelineFixRunView, PipelineJobView } from "../utils/pipelinePayload";
import { PipelineJobList } from "./PipelineJobList";
import { PipelineFixRunList } from "./PipelineFixRunList";

/** The pipeline gate's status/progress UI (task 18): the green banner and
 *  fix-run history promoted verbatim out of the built-in `PipelineView`
 *  (its DOM is unchanged), plus the artifact-snapshot projection — the
 *  status badge, the job list and the retrigger affordance — so any gate
 *  node's durable wait renders through the registry, not just the built-in
 *  `pipeline` def. Presentational (AGENTS §2.2): data in, JSX out.
 */
export interface PipelineStatusBodyProps {
  /** the gate completed — the moved green banner shows (the built-in panel
   *  keys it off the node's terminal status, the artifact snapshot off
   *  `status === success`) */
  green: boolean;
  /** the watched pipeline's status — the snapshot badge. The built-in panel
   *  passes none: its failure surface is the shell's banner + footer. */
  status?: string;
  /** the last pipeline the gate watched — null when none was ever seen */
  pipelineId: number | null;
  /** how many fix runs the gate spent on the watched pipeline */
  fixes: number;
  /** the pipeline's job snapshot — the artifact path's data */
  jobs?: readonly PipelineJobView[];
  /** the fix-run ledger — the artifact path's data */
  fixRuns?: readonly PipelineFixRunView[];
  /** the fix-run history slot — the built-in panel's versioned `fix`
   *  artifacts (the block moved out of PipelineView verbatim) */
  history?: ReactNode;
  /** the panel's action dispatcher the retrigger affordance fires through */
  action?: PanelActionFn;
  /** the node key the `retrigger_pipeline` verb dispatches to (the built-in
   *  panel passes its own; the artifact path reads the snapshot's meta) */
  nodeKey?: string;
}

export const PipelineStatusBody = ({
  green,
  status,
  pipelineId,
  fixes,
  jobs,
  fixRuns,
  history,
  action,
  nodeKey,
}: PipelineStatusBodyProps) => (
  <>
    {green && pipelineId && (
      <Alert className="bg-success/10 text-success mb-3.5">
        <span className="flex-1">
          Pipeline #{pipelineId} is green{fixes ? ` after ${fixes} fix run${fixes > 1 ? "s" : ""}` : ""}.
        </span>
      </Alert>
    )}
    {!green && status && (
      <div className="flex items-center gap-2 mb-3.5">
        <Badge
          className={pipelineStatusVariant(status)}
          variant={status === PIPELINE_STATUS.FAILED ? "destructive" : undefined}
        >
          <span className="size-1.5 rounded-full bg-current" />
          Pipeline #{pipelineId ?? "—"} · {status}
        </Badge>
      </div>
    )}
    {jobs && jobs.length > 0 && <PipelineJobList jobs={jobs} />}
    {fixRuns && fixRuns.length > 0 && <PipelineFixRunList runs={fixRuns} />}
    {history}
    {action && nodeKey && status === PIPELINE_STATUS.FAILED && pipelineId != null && (
      <Button variant="outline" onClick={() => action(FLOW_ACTION.RETRIGGER_PIPELINE, { nodeKey })}>
        Retrigger pipeline
      </Button>
    )}
  </>
);