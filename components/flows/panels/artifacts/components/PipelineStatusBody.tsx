"use client";
import type { ReactNode } from "react";
import { ListChecks, Wrench } from "lucide-react";
import { FLOW_ACTION } from "@/constants/flow";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PIPELINE_STATUS, pipelineStatusVariant } from "../constants/pipelineStatus";
import type { PanelActionFn } from "../types/artifactRenderer";
import type { PipelineFixRunView, PipelineJobView } from "../utils/pipelinePayload";

const PIPELINE_LIST_CARD = "rounded-lg border border-border bg-background p-3.5 mb-3.5";
const PIPELINE_LIST_HEADER = "flex items-center gap-1.5 mb-2 text-[11.5px] font-medium text-muted-foreground uppercase tracking-[0.8px]";

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

/** The watched pipeline's jobs: name, manual-play marker, status badge. */
const PipelineJobList = ({ jobs }: { jobs: readonly PipelineJobView[] }) => (
  <div className={PIPELINE_LIST_CARD}>
    <div className={PIPELINE_LIST_HEADER}>
      <ListChecks size={12} /> Jobs
    </div>
    <ul className="m-0 p-0 list-none text-[12.5px]">
      {jobs.map((job) => (
        <li key={job.id} className="flex items-center gap-2 py-1">
          <span className="flex-1 truncate">{job.name}</span>
          {job.manual && <Badge variant="outline">manual</Badge>}
          <Badge
            className={pipelineStatusVariant(job.status)}
            variant={job.status === PIPELINE_STATUS.FAILED ? "destructive" : undefined}
          >
            <span className="size-1.5 rounded-full bg-current" />
            {job.status}
          </Badge>
        </li>
      ))}
    </ul>
  </div>
);

/** The fix-run ledger: one row per agent fix attempt the gate spent. */
const PipelineFixRunList = ({ runs }: { runs: readonly PipelineFixRunView[] }) => (
  <div className={PIPELINE_LIST_CARD}>
    <div className={PIPELINE_LIST_HEADER}>
      <Wrench size={12} /> Fix runs
    </div>
    <ol className="m-0 p-0 list-none text-[12.5px]">
      {runs.map((run) => (
        <li key={run.attempt} className="py-1">
          <span className="font-mono text-muted-foreground">#{run.attempt}</span>{" "}
          <span className="text-foreground/85">{run.summary}</span>
        </li>
      ))}
    </ol>
  </div>
);