"use client";
import { AlertTriangle } from "lucide-react";
import { PlainArtifact } from "./PlainArtifact";
import type { ArtifactPayload } from "../types/artifactPayload";
import { parseFailedOutputPayload } from "../utils/failedOutputPayload";

/**
 * The `failed_output` artifact renderer (Task 20, use case 8e): the exact bad
 * response a retry-exhausted run produced — the schema violations ledger plus
 * the raw response head — so the post-mortem and the failed node's Configure
 * dialog show what to fix before the in-place retry. Presentational only
 * (AGENTS §2.2): the loaded artifact in, JSX out; a meta without the ledger
 * renders the raw body plain.
 */
export const FailedOutputView = ({ artifact }: { artifact: ArtifactPayload }) => {
  const failure = parseFailedOutputPayload(artifact.meta);
  if (!failure) {
    return <PlainArtifact content={artifact.content} />;
  }
  return (
    <div className="rounded-lg border border-border bg-background p-3.5">
      <div className="flex items-center gap-1.5 mb-2 text-[11.5px] font-medium text-muted-foreground uppercase tracking-[0.8px]">
        <AlertTriangle size={12} /> Failed output
        <span className="normal-case tracking-normal text-destructive">{failure.code}</span>
        {failure.budget > 0 && (
          <span className="normal-case tracking-normal">{failure.budget} feedback {failure.budget === 1 ? "retry" : "retries"} spent</span>
        )}
      </div>
      {failure.issues.length > 0 && (
        <ul className="grid gap-1 m-0 mb-2 p-0 list-none text-[12.5px]">
          {failure.issues.map((issue) => (
            <li key={`${issue.path}:${issue.message}`} className="flex gap-2 items-baseline">
              <span className="font-mono text-[11px] text-muted-foreground shrink-0">{issue.path || "root"}</span>
              <span className="text-destructive">{issue.message}</span>
            </li>
          ))}
        </ul>
      )}
      <pre className="overflow-y-auto whitespace-pre-wrap border border-border rounded-md p-2.5 text-[12px] font-mono text-muted-foreground m-0">
        {artifact.content}
      </pre>
    </div>
  );
};