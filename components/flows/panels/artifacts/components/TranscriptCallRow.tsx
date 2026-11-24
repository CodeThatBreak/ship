"use client";
import { SquareTerminal } from "lucide-react";
import { fmtDuration } from "@/lib/format";
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import type { TranscriptCallView } from "../utils/transcriptPayload";

/**
 * One timeline row: the call's name, its redacted args summary and duration
 * on the collapsed line, the full summary in the collapsible body. Local to
 * the transcript renderer (single consumer, presentational).
 */
export const TranscriptCallRow = ({ call }: { call: TranscriptCallView }) => {
  const failed = /fail|error/i.test(call.status);
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine status={failed ? "error" : undefined}>
          <TraceIcon>
            <SquareTerminal size={14} />
          </TraceIcon>
          <TraceTitle>
            {failed ? "Failed" : "Ran"} {call.name}
          </TraceTitle>
          {/* the redacted args summary can be long: let it shrink and ellipsize
              instead of pushing the duration (and the row) past the panel */}
          {call.summary && (
            <TraceDescription className="ms-1 min-w-0 shrink truncate" title={call.summary}>
              {call.summary}
            </TraceDescription>
          )}
          {call.durationMs != null && (
            <TraceDescription className="ms-1 shrink-0">{fmtDuration(call.durationMs)}</TraceDescription>
          )}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        {call.summary ?? "no arguments recorded"}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
};
