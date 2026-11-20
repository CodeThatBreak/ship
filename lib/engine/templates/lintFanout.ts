import "server-only";

import { db } from "../../db/app";
import { NODE_KEYS } from "../constants/nodeKeys";
import { fanoutOf } from "./nodeConfig";
import { parseJsonObject } from "./utils/parseJsonObject";
import { shallowMerge } from "./utils/shallowMerge";
import type { LintProblem } from "@/types/templateLint";
import type { CatalogEntry, LintEdge, LintNode } from "./lintTypes";

/**
 * Fan-out authoring rules 1–3 (build-time gate for the declarative fan-out):
 *
 * 1. a node with `fanout.mode != whole` must be downstream of a plan node —
 *    reachability from the template's plan-kind nodes via next edges (any
 *    kind of plan-tagged built-in: the registry entry key);
 * 2. an explicit child template must resolve to an existing flow_templates row;
 * 3. the child must stay a ONE-NODE chain (no plan/pipeline/review/resolve, no
 *    fan-out nesting) — the "children never gain a full SDLC" and "no nesting"
 *    locked decisions are enforced here, not just declared.
 *
 * Every problem stamps the offending parent node's key (canvas badge target).
 */
export const lintFanoutRules = async (
  nodes: LintNode[],
  edges: LintEdge[],
  catalog: Record<string, CatalogEntry>,
  problems: LintProblem[],
): Promise<void> => {
  const fanoutNodes = nodes.filter((n) => {
    const nt = catalog[n.nodeTemplateId];
    return nt && fanoutOf(shallowMerge(nt.config, n.config)).mode !== "whole";
  });
  if (!fanoutNodes.length) return;

  // ── fan-out rule 1: a node with fanout.mode != whole must be downstream of
  // a plan node — reachability from the template's plan-kind nodes via next
  // edges (any kind of plan-tagged built-in: the registry entry key)
  const seen = new Set<string>();
  const queue = nodes
    .filter((n) => {
      const nt = catalog[n.nodeTemplateId];
      return nt?.isBuiltin && nt.key === NODE_KEYS.PLAN;
    })
    .map((n) => n.key);
  for (const k of queue) seen.add(k);
  while (queue.length) {
    const k = queue.shift();
    if (k === undefined) break;
    for (const e of edges) {
      if (e.kind !== "next" || e.from !== k || seen.has(e.to)) continue;
      seen.add(e.to);
      queue.push(e.to);
    }
  }
  for (const n of fanoutNodes) {
    if (!seen.has(n.key)) {
      problems.push({
        where: `node "${n.key}"`,
        message: `fan-out mode "${fanoutOf(shallowMerge(catalog[n.nodeTemplateId]?.config, n.config)).mode}" requires a plan node upstream — this node is never downstream of a plan key`,
        nodeKey: n.key,
      });
    }
  }
  // ── fan-out rule 2 + 3: an explicit child template must resolve, and the
  // child must stay a ONE-NODE chain (no plan/pipeline/review/resolve, no
  // fan-out nesting) — the "children never gain a full SDLC" and "no
  // nesting" locked decisions are enforced here, not just declared
  for (const n of fanoutNodes) {
    const cfg = fanoutOf(shallowMerge(catalog[n.nodeTemplateId]?.config, n.config));
    if (!cfg.child) continue;
    const child = await db.prisma.flowTemplate.findFirst({
      where: { id: cfg.child },
      select: { id: true },
    });
    if (!child) {
      problems.push({
        where: `node "${n.key}"`,
        message: `fan-out child template "${cfg.child}" does not exist (a gallery template id, or null for the auto-selected child)`,
        nodeKey: n.key,
      });
      continue;
    }
    // joins-as-separate-typed-queries: the child's node rows with their
    // catalog entries (the relation ships nodeTemplate in one round trip)
    const childNodeRows = await db.prisma.flowTemplateNode.findMany({
      where: { templateId: cfg.child },
      include: { nodeTemplate: true },
    });
    const childNodes = childNodeRows.map((n) => ({
      nodeKey: n.nodeKey,
      kind: n.nodeTemplate.kind,
      ntKey: n.nodeTemplate.key,
      config: n.config,
      nodeTemplateId: n.nodeTemplateId,
    }));
    if (childNodes.length !== 1) {
      problems.push({
        where: `node "${n.key}"`,
        message: `fan-out child template "${cfg.child}" must contain exactly one node (found ${childNodes.length})`,
        nodeKey: n.key,
      });
    }
    for (const cn of childNodes) {
      if (
        cn.kind === "builtin"
        && ([NODE_KEYS.PLAN, NODE_KEYS.PIPELINE, NODE_KEYS.REVIEW, NODE_KEYS.RESOLVE] as readonly string[]).includes(cn.ntKey)
      ) {
        problems.push({
          where: `node "${n.key}"`,
          message: `fan-out child template "${cfg.child}" contains a "${cn.ntKey}" node — children are one-node chains, never a full SDLC`,
          nodeKey: n.key,
        });
      }
      if (fanoutOf(parseJsonObject(cn.config)).mode !== "whole") {
        problems.push({
          where: `node "${n.key}"`,
          message: `fan-out child template "${cfg.child}" carries its own fan-out knob — nesting is not allowed (single cap level)`,
          nodeKey: n.key,
        });
      }
    }
  }
};
