"use client";
import { ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PIPELINE_STATUS, pipelineStatusVariant } from "../constants/pipelineStatus";
import { PIPELINE_LIST_CARD, PIPELINE_LIST_HEADER } from "../constants/pipelineStyles";
import type { PipelineJobView } from "../utils/pipelinePayload";

/** The watched pipeline's jobs: name, manual-play marker, status badge. */
export const PipelineJobList = ({ jobs }: { jobs: readonly PipelineJobView[] }) => (
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
