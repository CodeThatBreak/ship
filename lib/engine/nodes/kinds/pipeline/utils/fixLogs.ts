import "server-only";

import type { HostJob } from "../../../../ports/gitHost";
import { untrustedData } from "../../../../prompts/untrustedData";
import { FIX_JOB_LOGS, FIX_JOB_TRACE_TAIL } from "../constants/waiting";

/** What the gate's fix-prompt log section assembles: the fenced job logs plus
 *  the loud-cap messages naming every truncation applied (empty = none) — the
 *  runner turns them into ONE `log` event on the gate node. */
export interface FixLogs {
  readonly logs: string;
  readonly truncations: string[];
}

/**
 * Assemble the failed-jobs log block for the fix prompt (the existing 3×8k
 * budget, values unchanged): only the first `FIX_JOB_LOGS` failed jobs, each
 * trace tail-capped to `FIX_JOB_TRACE_TAIL` characters. Every cap that bites
 * appends a loud in-prompt note and is recorded in `truncations` — silent
 * truncation is banned (step 05, target-architecture §5.3).
 */
export const assembleFixLogs = async (
  failed: readonly HostJob[],
  traceOf: (job: HostJob) => Promise<string>,
): Promise<FixLogs> => {
  const truncations: string[] = [];
  const dropped = failed.slice(FIX_JOB_LOGS);
  if (dropped.length > 0) {
    truncations.push(
      `failed-job logs capped to the first ${FIX_JOB_LOGS} job(s) — ${dropped.length} failed job(s) omitted`,
    );
  }

  let logs = "";
  for (const j of failed.slice(0, FIX_JOB_LOGS)) {
    const trace = await traceOf(j).catch(() => "");
    // the trace tail is untrusted CI output: fenced through the shared
    // untrusted-data wrapper, tail-capped (cap value unchanged)
    const tail = trace
      ? untrustedData({ source: `CI job ${j.name} (#${j.id}) log`, text: trace, cap: FIX_JOB_TRACE_TAIL, tail: true })
      : null;
    if (tail?.truncated) {
      truncations.push(
        `CI job ${j.name} (#${j.id}) log tail-capped to the last ${FIX_JOB_TRACE_TAIL} of ${tail.originalLength} characters`,
      );
    }
    logs += `\n\n===== job ${j.name} (#${j.id}) =====\n${tail?.text ?? ""}`;
  }
  if (dropped.length > 0) {
    logs += `\n\n[only the first ${FIX_JOB_LOGS} failed jobs' logs are included — ${dropped.length} failed job(s) were omitted from this prompt]`;
  }
  return { logs, truncations };
};
