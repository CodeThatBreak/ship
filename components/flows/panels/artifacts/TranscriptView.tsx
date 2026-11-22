"use client";
import { ScrollText, SquareTerminal } from "lucide-react";
import { fmtDuration } from "@/lib/format";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { PlainArtifact } from "./components/PlainArtifact";
import type { ArtifactPayload } from "./types/artifactPayload";
import { parseTranscriptPayload, type TranscriptCallView } from "./utils/transcriptPayload";

/**
 * One timeline row: the call's name, its redacted args summary and duration
 * on the collapsed line, the full summary in the collapsible body. Local to
 * the transcript view (single consumer, presentational).
 */
const TranscriptCallRow = ({ call }: { call: TranscriptCallView }) => {
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

/**
 * The `transcript` artifact renderer (task 22, use case 8c): one run's capped
 * tool-call log as a collapsible timeline — what ran, in order, with a
 * redacted args summary per call. Presentational only (AGENTS §2.2): the
 * loaded artifact in, JSX out — loading and error states live in the shared
 * `ArtifactLoader` wrapper, the malformed-content fallback here.
 */
export const TranscriptView = ({ artifact }: { artifact: ArtifactPayload }) => {
  const transcript = parseTranscriptPayload(artifact.content);
  if (!transcript) {
    return <PlainArtifact content={artifact.content} />;
  }
  return (
    <div className="rounded-lg border border-border bg-background p-3.5">
      <div className="flex items-center gap-1.5 mb-2 text-[11.5px] font-medium text-muted-foreground uppercase tracking-[0.8px]">
        <ScrollText size={12} /> Tool transcript · {transcript.totalCalls} {transcript.totalCalls === 1 ? "call" : "calls"}
      </div>
      {transcript.truncated && (
        <p className="mt-0 mb-2 text-[11px] text-muted-foreground">
          showing the first {transcript.calls.length} of {transcript.totalCalls} calls — the log was capped
        </p>
      )}
      <Trace size="sm">
        {transcript.calls.map((call, index) => (
          <TranscriptCallRow key={index} call={call} />
        ))}
      </Trace>
    </div>
  );
};