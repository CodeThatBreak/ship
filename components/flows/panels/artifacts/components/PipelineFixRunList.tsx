"use client";
import { Wrench } from "lucide-react";
import { PIPELINE_LIST_CARD, PIPELINE_LIST_HEADER } from "../constants/pipelineStyles";
import type { PipelineFixRunView } from "../utils/pipelinePayload";

/** The fix-run ledger: one row per agent fix attempt the gate spent. */
export const PipelineFixRunList = ({ runs }: { runs: readonly PipelineFixRunView[] }) => (
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
