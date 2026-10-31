/**
 * The condition/expression editor's constants: the ops table (the
 * editor-facing presentation of the grammar in `condition-grammar.ts`), the
 * autocomplete panel's geometry and the live-feedback debounce timings.
 */
import type { ConditionOp, ConditionRow } from "../condition-grammar";
import type { Combinator } from "./types";

/** The ops the builder offers — plain comparisons; the JSONata is compiled. */
export const CONDITION_OPS: readonly {
  value: ConditionOp;
  label: string;
  needsValue: boolean;
}[] = [
  { value: "eq", label: "=", needsValue: true },
  { value: "ne", label: "≠", needsValue: true },
  { value: "gt", label: ">", needsValue: true },
  { value: "lt", label: "<", needsValue: true },
  { value: "contains", label: "contains", needsValue: true },
  { value: "empty", label: "is empty", needsValue: false },
  { value: "notEmpty", label: "is not empty", needsValue: false },
];

/** The combinator select's labels (lookup table, not inline branches). */
export const COMBINATOR_LABELS: Record<Combinator, string> = {
  and: "all (AND)",
  or: "any (OR)",
};

/** A fresh, still-empty row — the "Add condition" seed. Hoisted so the state
 *  seeds and array spreads share one stable reference (§2.5). */
export const EMPTY_ROW: ConditionRow = {
  path: "",
  op: "eq",
  value: "",
  valueKind: "string",
};

// ── the autocomplete panel's geometry ────────────────────────────────────────

/** The panel's fixed width (the w-80 the popover used to get). */
export const PANEL_WIDTH = 320;
/** The list's cap (the 14rem scroll cap + the panel's padding and border) —
 *  the flip-above decision needs the panel's worst-case height up front. */
export const PANEL_MAX_HEIGHT = 236;
/** The gap between the anchor field and the panel. */
export const PANEL_GAP = 4;
/** The breathing room the panel keeps from the viewport edges when clamping. */
export const VIEWPORT_MARGIN = 8;
/** How many paths the autocomplete shows at once. */
export const AUTOCOMPLETE_LIMIT = 8;

// ── live-feedback debounces (typing → server round trip / lint) ──────────────

export const PREVIEW_DEBOUNCE_MS = 400;
export const LINT_DEBOUNCE_MS = 300;

// ── field placeholders (the shared fallback copy) ────────────────────────────

export const PATH_FIELD_PLACEHOLDER =
  "variable — e.g. nodes.build.output.mr_url";
export const RAW_EXPRESSION_PLACEHOLDER =
  "JSONata expression — e.g. nodes.build.output.mr_url != null";
