import "server-only";

import { lintJsonata } from "@/lib/jsonata/eval";
import { nodeOutputRefs } from "@/lib/jsonata/nodeOutputRefs";
import { FACT_KIND, NEEDABLE_FACTS } from "../facts/types/facts";
import { EFFECT_VERB } from "../runtime/effects/constants/effectVerbs";
import { shallowMerge } from "./utils/shallowMerge";
import type { LintProblem } from "@/types/templateLint";
import type { AddressesOutput, CatalogEntry, LintEdge, LintNode, NodeContract } from "./lintTypes";
import type { NeedableFact } from "../facts/types/facts";

/**
 * The JSONata expression checks: every static expression a template carries
 * (input_map fields, decision pass/choice conditions, http response_map,
 * edge/loop conditions) must compile at save/import, and the edge
 * conditions' `{{nodes.<key>.output.<field>}}` references must resolve
 * against the same contract map the {{...}} refs use (step 04) — same
 * wildcard / free-form free-passes, so builtin loop conditions stay valid.
 * Also the declarative fact-need satisfiability check (task 14): a node's
 * declared `needs` must be statically covered by some upstream node's
 * `produces`/`effects` declarations (graph walk over declarations only).
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

/** The string entries of one config key (non-arrays and non-string entries
 *  read as nothing — the def schemas own the type errors at save). */
const stringListOf = (cfg: Record<string, unknown>, key: string): string[] => {
  const raw = cfg[key];
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
};

/** The node's `effects` map when it is an object (the def schemas own the
 *  shape errors at save). */
const effectsOf = (cfg: Record<string, unknown>): Record<string, unknown> => {
  const effects = cfg.effects;
  return effects && typeof effects === "object" && !Array.isArray(effects)
    ? (effects as Record<string, unknown>)
    : {};
};

/**
 * What statically covers each needable fact (task 14, design §4.1) — the
 * declaration that establishes it, keyed by fact kind. Coverage is over
 * declarations only: an upstream that will hold a fact at run time (a
 * dynamic case) is invisible to this check by design.
 */
const NEED_ESTABLISHERS: Record<NeedableFact, (cfg: Record<string, unknown>) => boolean> = {
  // `branch` is covered by an upstream agent whose `produces` declares it
  [FACT_KIND.BRANCH]: (cfg) => stringListOf(cfg, "produces").includes(FACT_KIND.BRANCH),
  // `change_request` is covered by the verb that establishes it — an upstream
  // `effects.afterApproval` declaring `create_change_request`
  [FACT_KIND.CHANGE_REQUEST]: (cfg) =>
    stringListOf(effectsOf(cfg), "afterApproval").includes(EFFECT_VERB.CREATE_CHANGE_REQUEST),
};

/** The human-readable declaration that covers each fact (the failure message names it). */
const NEED_COVERAGE_HINT: Record<NeedableFact, string> = {
  [FACT_KIND.BRANCH]: `produces [${FACT_KIND.BRANCH}]`,
  [FACT_KIND.CHANGE_REQUEST]: `effects.afterApproval [${EFFECT_VERB.CREATE_CHANGE_REQUEST}]`,
};

/**
 * The declarative fact-need satisfiability check (task 14, design §4.1):
 * every node's declared `needs` must be satisfiable by some upstream node's
 * `produces`/`effects` declarations — a transitive walk upstream over the
 * template's next edges, checking declarations only. A need with no upstream
 * node at all (empty upstream closure) can never be satisfied. Unknown need
 * values are reported as a vocabulary error (mirrors the trigger checks).
 */
export const lintNeedsSatisfiability = (
  nodes: LintNode[],
  edges: LintEdge[],
  catalog: Record<string, CatalogEntry>,
  problems: LintProblem[],
): void => {
  // next-edge parents per node key
  const parentsOf = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind !== "next") continue;
    const parents = parentsOf.get(e.to) ?? [];
    parents.push(e.from);
    parentsOf.set(e.to, parents);
  }

  // the transitive upstream closure of one node (declarations only — no
  // runtime facts are chased)
  const upstreamClosureOf = (key: string): LintNode[] => {
    const seen = new Set<string>();
    const queue = [...(parentsOf.get(key) ?? [])];
    while (queue.length) {
      const current = queue.shift();
      if (current === undefined || seen.has(current)) continue;
      seen.add(current);
      queue.push(...(parentsOf.get(current) ?? []));
    }
    return nodes.filter((n) => seen.has(n.key));
  };

  for (const n of nodes) {
    const merged = shallowMerge(catalog[n.nodeTemplateId]?.config, n.config);
    const declared = stringListOf(merged, "needs");
    if (!declared.length) continue;

    for (const need of declared) {
      if (!(NEEDABLE_FACTS as readonly string[]).includes(need)) {
        problems.push({
          where: `node "${n.key}"`,
          message: `unknown need "${need}" — use one of: ${NEEDABLE_FACTS.join(", ")}`,
          nodeKey: n.key,
        });
        continue;
      }
      const satisfiable = upstreamClosureOf(n.key).some((up) =>
        NEED_ESTABLISHERS[need as NeedableFact](shallowMerge(catalog[up.nodeTemplateId]?.config, up.config)),
      );
      if (!satisfiable) {
        problems.push({
          where: `node "${n.key}"`,
          message: `need "${need}" is not satisfiable — no upstream node declares ${NEED_COVERAGE_HINT[need as NeedableFact]}`,
          nodeKey: n.key,
        });
      }
    }
  }
};
