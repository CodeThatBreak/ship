import "server-only";

import { lintJsonata } from "@/lib/jsonata/eval";
import { nodeOutputRefs } from "@/lib/jsonata/nodeOutputRefs";
import type { LintProblem } from "@/types/templateLint";
import type { AddressesOutput, CatalogEntry, LintEdge, LintNode, NodeContract } from "./lintTypes";

/**
 * The JSONata expression checks: every static expression a template carries
 * (input_map fields, decision pass/choice conditions, http response_map,
 * edge/loop conditions) must compile at save/import, and the edge
 * conditions' `{{nodes.<key>.output.<field>}}` references must resolve
 * against the same contract map the {{...}} refs use (step 04) — same
 * wildcard / free-form free-passes, so builtin loop conditions stay valid.
 */

/** Per-field input_map expressions must compile. */
export const lintInputMapJsonata = (n: LintNode, problems: LintProblem[]): void => {
  for (const [field, expr] of Object.entries(n.inputMap ?? {})) {
    if (typeof expr !== "string") continue;
    const err = lintJsonata(expr);
    if (err) problems.push({ where: `node "${n.key}"`, message: `input_map.${field}: ${err}`, nodeKey: n.key });
  }
};

/**
 * Decision definitions: the pass-down map compiles (any source); per-choice
 * conditions when source=expression.
 */
export const lintDecisionJsonata = (cfg: Record<string, unknown>, n: LintNode, problems: LintProblem[]): void => {
  if (cfg.pass && typeof cfg.pass === "object" && !Array.isArray(cfg.pass)) {
    for (const [field, expr] of Object.entries(cfg.pass as Record<string, unknown>)) {
      if (typeof expr !== "string" || !expr.trim() || !field.trim()) continue;
      const err = lintJsonata(expr);
      if (err) problems.push({ where: `node "${n.key}"`, message: `pass variable "${field}": ${err}`, nodeKey: n.key });
    }
  }
  if (typeof cfg.source === "string" && cfg.source === "expression") {
    if (Array.isArray(cfg.choices)) {
      for (const c of cfg.choices as { label?: unknown; condition?: unknown }[]) {
        if (!c || typeof c !== "object" || typeof c.condition !== "string" || !c.condition.trim()) continue;
        const err = lintJsonata(c.condition);
        if (err) problems.push({ where: `node "${n.key}"`, message: `choice "${String(c.label ?? "?")}" condition: ${err}`, nodeKey: n.key });
      }
    }
  }
};

/** http response_map compiles. */
export const lintHttpJsonata = (cfg: Record<string, unknown>, n: LintNode, problems: LintProblem[]): void => {
  if (typeof cfg.response_map === "string" && cfg.response_map.trim()) {
    const err = lintJsonata(cfg.response_map);
    if (err) problems.push({ where: `node "${n.key}"`, message: `response_map: ${err}`, nodeKey: n.key });
  }
};

/**
 * Edge + loop conditions compile (not on decision branches — those gate on
 * labels), and their `nodes.<key>.output.<field>` references resolve against
 * the node contracts.
 */
export const lintEdgeConditions = (
  edges: LintEdge[],
  nodes: LintNode[],
  catalog: Record<string, CatalogEntry>,
  byKey: Map<string, LintNode>,
  contractOfKey: Map<string, NodeContract>,
  addressesOutput: AddressesOutput,
  problems: LintProblem[],
): void => {
  for (const [i, e] of edges.entries()) {
    if (!e.condition?.trim()) continue;
    const src = catalog[nodes.find((n) => n.key === e.from)?.nodeTemplateId ?? ""];
    if (src?.kind === "decision") continue;
    const err = lintJsonata(e.condition);
    if (err) problems.push({ where: `edge ${e.from} → ${e.to}`, message: err, edgeIndex: i });
    // the raw expression's `nodes.<key>.output.<field>` references resolve
    // against the same contract map the {{...}} refs use (step 04) — same
    // wildcard / free-form free-passes, so builtin loop conditions stay valid
    for (const { nodeKey, field } of nodeOutputRefs(e.condition)) {
      const where = `edge ${e.from} → ${e.to}`;
      const stamp = { where, edgeIndex: i };
      if (!byKey.has(nodeKey)) {
        problems.push({ ...stamp, message: `the condition references unknown node "${nodeKey}"` });
        continue;
      }
      addressesOutput(`${nodeKey}.output.${field}`, (unknownField) => {
        const fields = contractOfKey.get(nodeKey)?.fields ?? [];
        problems.push({
          ...stamp,
          message: `node "${nodeKey}" publishes ${
            fields.length === 1 && fields[0] === "markdown" ? '{"markdown"}' : "fields " + JSON.stringify(fields)
          } — not .${unknownField}`,
        });
      });
    }
  }
};
