import "server-only";

import { evalJsonata } from "@/lib/jsonata/eval";
import type { FlowContextMap } from "../../../context/flowVariables";

/**
 * The template node's `input_map` evaluation (§3): `{field: JSONata expr}`
 * over the flow context, evaluated at trigger time and merged over the
 * caller's raw input — a mapped field wins over the same key in the raw
 * input. A failing expression fails the node loudly with the field name.
 *
 * Shared by the StageRunner's run path (the def-run input) and the subflow
 * expansion gate (the child payload) so the two can never drift — the gate
 * owns the stage, so it must materialize the SAME input the def run would
 * have seen.
 */
export const evalInputMapOver = async (args: {
  nodeKey: string;
  rawInput: unknown;
  /** the prebuilt flow context map (pass when the caller already built one) */
  ctxMap?: FlowContextMap;
  /** the resolved input map (the caller owns the graph lookup) */
  inputMap?: Record<string, unknown>;
}): Promise<unknown> => {
  const map = args.inputMap ?? {};
  const entries = Object.entries(map).filter(([, v]) => typeof v === "string" && (v as string).trim());
  if (!entries.length) return args.rawInput;
  const base: Record<string, unknown> =
    args.rawInput && typeof args.rawInput === "object" && !Array.isArray(args.rawInput)
      ? { ...(args.rawInput as Record<string, unknown>) }
      : {};
  const ctx = args.ctxMap ?? {};
  for (const [field, expr] of entries) {
    const r = await evalJsonata(expr as string, ctx);
    if (!r.ok) {
      throw new Error(`${args.nodeKey}: input_map.${field} ("${expr}") failed — ${r.error}`);
    }
    if (r.value !== undefined) base[field] = r.value;
  }
  return base;
};
