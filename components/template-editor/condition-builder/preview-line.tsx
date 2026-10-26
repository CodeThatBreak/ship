"use client";
/**
 * The `= value` line rendered under the editors (shared by the builder and
 * the raw box): a loading pulse, the error plus its retry action, or the
 * value labelled with the context it evaluated against (sample data vs the
 * template's most recent flow run).
 */
import { PreviewLineSkeleton } from "./preview-line-skeleton";
import type { PreviewState } from "./types";

export function PreviewLine({
  state,
  retry,
  prefix = "=",
}: {
  state: PreviewState;
  /** offered on errors — re-runs the evaluation (TanStack Query refetch) */
  retry?: () => void;
  prefix?: string;
}) {
  if (state.loading) return <PreviewLineSkeleton prefix={prefix} />;
  if (state.error) {
    return (
      <p className="text-[11px] text-destructive m-0 flex items-center gap-1.5">
        <span>
          {prefix} error — {state.error}
        </span>
        {retry && (
          <button
            type="button"
            onClick={retry}
            className="underline underline-offset-2 hover:opacity-80"
          >
            retry
          </button>
        )}
      </p>
    );
  }
  if (!("value" in state)) return null;
  const v = state.value;
  const rendered =
    v === null
      ? "null"
      : typeof v === "string"
        ? JSON.stringify(v)
        : typeof v === "object"
          ? JSON.stringify(v)
          : String(v);
  return (
    <p
      className="text-[11px] text-success m-0"
      title={
        state.source === "sample"
          ? "Evaluated against sample data — no flow has run from this template yet"
          : "Evaluated against the template's most recent flow run"
      }
    >
      {prefix} {rendered}
      <span className="ml-1.5 text-[10px] text-muted-foreground">
        {state.source === "sample" ? "· sample data" : "· last run"}
      </span>
    </p>
  );
}
