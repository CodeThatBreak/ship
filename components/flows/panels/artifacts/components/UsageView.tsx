"use client";
import { Coins } from "lucide-react";
import { fmtDuration, fmtTokens } from "@/lib/format";
import { uncachedInputTokens } from "@/lib/usage";
import { PlainArtifact } from "./PlainArtifact";
import { formatCostCents } from "../../utils/costFormat";
import type { ArtifactPayload } from "../types/artifactPayload";
import { parseUsagePayload } from "../utils/usagePayload";

/**
 * The `usage` artifact renderer (Task 21, use case 8d): one run's token/cost
 * facts — model, the input (uncached) / output / cache token split, the
 * duration, and the priced cost with its estimate marker. Presentational
 * only (AGENTS §2.2): the loaded artifact in, JSX out — loading and error
 * states live in the shared `ArtifactLoader` wrapper, the empty state here.
 */
export const UsageView = ({ artifact }: { artifact: ArtifactPayload }) => {
  const usage = parseUsagePayload(artifact.content);
  if (!usage) {
    return <PlainArtifact content={artifact.content} />;
  }
  const input = uncachedInputTokens({
    inputTokens: usage.inputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
  });
  const total = input + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;

  const rows = [
    { label: "model", value: usage.model ?? "unknown" },
    { label: "input (uncached)", value: fmtTokens(input) },
    { label: "output", value: fmtTokens(usage.outputTokens) },
    { label: "cache (read + write)", value: fmtTokens(usage.cacheReadTokens + usage.cacheWriteTokens) },
    { label: "total", value: fmtTokens(total) },
    ...(usage.durationMs != null ? [{ label: "duration", value: fmtDuration(usage.durationMs) }] : []),
    {
      label: "cost",
      value: usage.costCents != null
        ? `${formatCostCents(usage.costCents)}${usage.estimated ? " (estimated)" : ""}`
        : "n/a",
    },
  ];

  return (
    <div className="rounded-lg border border-border bg-background p-3.5">
      <div className="flex items-center gap-1.5 mb-2 text-[11.5px] font-medium text-muted-foreground uppercase tracking-[0.8px]">
        <Coins size={12} /> Run usage
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 m-0 text-[12.5px]">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="font-mono text-muted-foreground m-0">{row.label}</dt>
            <dd className="font-mono text-foreground/85 m-0 text-right tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
      {usage.estimated && (
        <p className="mt-2 mb-0 text-[11px] text-muted-foreground">
          cost is estimated from list prices — billed value unavailable
        </p>
      )}
    </div>
  );
};