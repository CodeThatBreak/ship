import type { Node } from "@/types/flow";
import type { StartContractField } from "@/types/startContract";

/** Trigger form prefill: the last run's values win, then the authored defaults. */
export function prefillStartValues(node: Node, fields: StartContractField[]): Record<string, unknown> {
  const recorded = (node.input && typeof node.input === "object" ? { ...(node.input as Record<string, unknown>) } : {});
  delete recorded.prompt;
  delete recorded.model;
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const r = recorded[f.key];
    out[f.key] = r !== undefined && r !== null ? r : (f.default !== undefined && f.default !== null ? f.default : "");
  }
  return out;
}

/** The read-only rendering of a published start value. */
export function fmtStartValue(v: unknown): string {
  if (typeof v === "string") return `"${v}"`;
  return JSON.stringify(v);
}
