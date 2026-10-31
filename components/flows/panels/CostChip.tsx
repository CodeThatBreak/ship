"use client";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Node } from "@/types/flow";
import { Badge } from "@/components/ui/badge";
import { uncachedInputTokens } from "@/lib/usage";
import { fmtDuration, fmtTokens } from "@/lib/format";
import { formatCostCents } from "./utils/cost-format";

/** One node run row as the engine rolls them up (`NodeCost.runs`). */
interface CostRun {
  status?: string;
  model?: string | null;
  duration_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  cost_cents?: number | null;
}

/**
 * Σ of the node's runs (duration · tokens · cost) with a tooltip renderer that
 * breaks the total down per run: status, model, duration, the input/output/
 * cache token split, and each run's cost — so "cost n/a" rows are visible as
 * exactly that instead of being silently averaged away. `in` shows the
 * uncached portion (`uncachedInputTokens`), matching how Cursor's usage API
 * and billing break the prompt up — exactly the figures the API reports.
 */
export function CostChip({ node }: { node: Node }) {
  const cost = node.cost;
  const runs = (cost?.runs ?? []) as CostRun[];
  if (!cost || !runs.length) return null;

  const rows = runs.map((r, i) => {
    const input = uncachedInputTokens({
      inputTokens: r.input_tokens,
      cacheReadTokens: r.cache_read_tokens,
      cacheWriteTokens: r.cache_write_tokens,
    });
    const output = r.output_tokens ?? 0;
    const cacheRead = r.cache_read_tokens ?? 0;
    const cacheWrite = r.cache_write_tokens ?? 0;
    return { i: i + 1, status: r.status, model: r.model, durationMs: r.duration_ms, input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite, costCents: r.cost_cents };
  });
  const priced = rows.some((r) => r.costCents != null);
  const totalTok = rows.reduce((s, r) => s + r.total, 0);
  const totalMs = rows.reduce((s, r) => s + (r.durationMs ?? 0), 0);

  const meta = [
    `${runs.length} run${runs.length > 1 ? "s" : ""}`,
    fmtTokens(totalTok) !== "—" ? `${fmtTokens(totalTok)} tok` : null,
    fmtDuration(totalMs) !== "—" ? fmtDuration(totalMs) : null,
    priced ? formatCostCents(cost.totalCents) : "cost n/a",
  ].filter(Boolean).join(" · ");

  return (
    <Tooltip>
      <TooltipTrigger>
        <Badge className="cursor-help">{meta}</Badge>
      </TooltipTrigger>
      <TooltipContent className="flex-col items-stretch gap-2 px-3.5 py-3 text-[11px] w-max max-w-none" side="bottom">
        <div className="font-medium opacity-70">Token &amp; cost breakdown</div>
        <table className="border-collapse">
          <thead>
            <tr className="text-left opacity-70">
              <th className="px-2.5 py-0.5 font-normal">#</th>
              <th className="px-2.5 py-0.5 font-normal">model</th>
              <th className="px-2.5 py-0.5 font-normal text-right">in</th>
              <th className="px-2.5 py-0.5 font-normal text-right">out</th>
              <th className="px-2.5 py-0.5 font-normal text-right">cache</th>
              <th className="px-2.5 py-0.5 font-normal text-right">total</th>
              <th className="px-2.5 py-0.5 font-normal text-right">dur</th>
              <th className="px-2.5 py-0.5 font-normal text-right">cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.i} className="border-t border-background/15">
                <td className="px-2.5 py-0.5 opacity-70">{r.i}</td>
                <td className="max-w-[180px] truncate px-2.5 py-0.5">{r.model ?? "unknown"}</td>
                <td className="px-2.5 py-0.5 text-right font-mono tabular-nums">{fmtTokens(r.input)}</td>
                <td className="px-2.5 py-0.5 text-right font-mono tabular-nums">{fmtTokens(r.output)}</td>
                <td className="px-2.5 py-0.5 text-right font-mono tabular-nums">{fmtTokens(r.cacheRead + r.cacheWrite)}</td>
                <td className="px-2.5 py-0.5 text-right font-mono tabular-nums">{fmtTokens(r.total)}</td>
                <td className="px-2.5 py-0.5 text-right opacity-70">{fmtDuration(r.durationMs)}</td>
                <td className="px-2.5 py-0.5 text-right">
                  {r.costCents != null ? formatCostCents(r.costCents) : <span className="opacity-50">n/a</span>}
                </td>
              </tr>
            ))}
            <tr className="border-t border-background/15 font-medium">
              <td className="px-2.5 py-0.5" />
              <td className="px-2.5 py-0.5">total</td>
              <td className="px-2.5 py-0.5 text-right font-mono tabular-nums">{fmtTokens(rows.reduce((s, r) => s + r.input, 0))}</td>
              <td className="px-2.5 py-0.5 text-right font-mono tabular-nums">{fmtTokens(rows.reduce((s, r) => s + r.output, 0))}</td>
              <td className="px-2.5 py-0.5 text-right font-mono tabular-nums">{fmtTokens(rows.reduce((s, r) => s + r.cacheRead + r.cacheWrite, 0))}</td>
              <td className="px-2.5 py-0.5 text-right font-mono tabular-nums">{fmtTokens(totalTok)}</td>
              <td className="px-2.5 py-0.5 text-right opacity-70">{fmtDuration(totalMs)}</td>
              <td className="px-2.5 py-0.5 text-right">{priced ? formatCostCents(cost.totalCents) : <span className="opacity-50">n/a</span>}</td>
            </tr>
          </tbody>
        </table>
        {priced && <div className="opacity-60">cost is estimated from list prices — billed value unavailable</div>}
      </TooltipContent>
    </Tooltip>
  );
}
