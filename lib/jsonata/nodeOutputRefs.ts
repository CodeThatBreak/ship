import "server-only";

import jsonata from "jsonata";

/**
 * Static `nodes.<key>.output.<field>` reference extraction from raw JSONata
 * expressions (§5 build-time checks — step 04): edge and loop `condition`s
 * carry raw expressions (no `{{...}}` wrappers), so the template linter needs
 * the same output-contract checks the template refs get.
 *
 * The walk is deliberately generic — every object/array value of the compiled
 * AST is visited — so paths nested anywhere (comparison operands, filter
 * predicates, function arguments, blocks) are found. A compile failure returns
 * []: syntax problems are `lintJsonata`'s job and are reported separately.
 */

/** One `nodes.<key>.output.<field>` reference found in an expression. */
export interface NodeOutputRef {
  nodeKey: string;
  field: string;
}

/** Defensive cap — a template-authored condition is never this deep. */
const MAX_AST_DEPTH = 64;

const isLooseStep = (step: unknown): boolean => {
  const type = step && typeof step === "object" ? (step as { type?: unknown }).type : null;
  return type === "wildcard" || type === "descendant";
};

/** A name step's string value (`name` steps; bracket literals arrive as
 *  `string` steps — the parser normalizes plain ones, but stay tolerant). */
const nameStepValue = (step: unknown): string | null => {
  if (!step || typeof step !== "object") return null;
  const s = step as { type?: unknown; value?: unknown };
  if ((s.type === "name" || s.type === "string") && typeof s.value === "string") return s.value;
  return null;
};

const isNameStep = (step: unknown, value: string): boolean => nameStepValue(step) === value;

/**
 * Scan one path's steps for contiguous `nodes <key> output <field>` runs.
 * A wildcard/descendant inside the run breaks the match (free-pass — the
 * same tolerance the {{...}} ref checks apply to `*`/`**` shapes).
 */
const collectPathRefs = (steps: unknown[], out: Map<string, NodeOutputRef>): void => {
  for (let i = 0; i + 3 < steps.length; i++) {
    if (!isNameStep(steps[i], "nodes")) continue;
    if (isLooseStep(steps[i + 1])) continue; // any node key — free-pass
    const nodeKey = nameStepValue(steps[i + 1]);
    if (nodeKey == null) continue;
    if (!isNameStep(steps[i + 2], "output")) continue;
    if (isLooseStep(steps[i + 3])) continue; // any field — free-pass
    const field = nameStepValue(steps[i + 3]);
    if (field == null) continue;
    out.set(`${nodeKey}.${field}`, { nodeKey, field });
  }
};

const visit = (node: unknown, depth: number, out: Map<string, NodeOutputRef>): void => {
  if (node == null || typeof node !== "object" || depth > MAX_AST_DEPTH) return;
  if (Array.isArray(node)) {
    for (const item of node) visit(item, depth + 1, out);
    return;
  }
  const rec = node as Record<string, unknown>;
  if (rec.type === "path" && Array.isArray(rec.steps)) collectPathRefs(rec.steps, out);
  for (const value of Object.values(rec)) visit(value, depth + 1, out);
};

/**
 * Collect every `nodes.<key>.output.<field>` path reference in a JSONata
 * expression, deduped. Unknown/loose shapes (`*`, `**`, non-name segments)
 * are skipped — the linter free-passes them the way it does template refs.
 */
export const nodeOutputRefs = (expr: string): NodeOutputRef[] => {
  let ast: jsonata.ExprNode;
  try {
    // .ast() is synchronous in jsonata v2 (only evaluate() is async)
    ast = (jsonata(expr) as jsonata.Expression).ast();
  } catch {
    return []; // syntax problems are lintJsonata's job
  }
  const found = new Map<string, NodeOutputRef>();
  visit(ast, 0, found);
  return [...found.values()];
};
