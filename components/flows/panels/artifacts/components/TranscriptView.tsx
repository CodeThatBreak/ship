"use client";
import { ScrollText } from "lucide-react";
import { Trace } from "@/components/ui/trace";
import { PlainArtifact } from "./PlainArtifact";
import { TranscriptCallRow } from "./TranscriptCallRow";
import type { ArtifactPayload } from "../types/artifactPayload";
import { parseTranscriptPayload } from "../utils/transcriptPayload";

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