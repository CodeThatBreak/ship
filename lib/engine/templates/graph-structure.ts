import "server-only";

import type { LintProblem } from "@/types/template-lint";
import {
  edgeDedupeKey,
  TEMPLATE_NODE_KEY_PATTERN,
} from "@/constants/template-graph";

export interface GraphStructureNode {
  key: string;
  nodeTemplateId: string;
  config?: Record<string, unknown>;
}

export interface GraphStructureEdge {
  from: string;
  to: string;
  kind?: string;
  label?: string | null;
  condition?: string | null;
}

/** Catalog row fields needed for structural graph rules. */
export interface GraphStructureNodeTemplate {
  kind: string;
  key: string;
  isBuiltin: boolean;
  /** decision choice labels when kind === "decision" */
  decisionChoices?: string[];
}

const NEXT_CYCLE_MESSAGE =
  "the next-edge graph has a cycle — use a loop edge for re-entry";

/** Pure structural template graph rules shared by save, /validate and import. */
export const lintGraphStructure = (
  nodes: GraphStructureNode[],
  edges: GraphStructureEdge[],
  resolveNodeTemplate: (node: GraphStructureNode) => GraphStructureNodeTemplate | null,
): LintProblem[] => {
  const problems: LintProblem[] = [];
  if (!Array.isArray(nodes)) {
    problems.push({ where: "template", message: "a template needs a nodes array" });
    return problems;
  }

  const keys = new Set<string>();
  const kindByKey = new Map<string, string>();

  for (const n of nodes) {
    const key = (n.key ?? "").trim();
    if (!TEMPLATE_NODE_KEY_PATTERN.test(key)) {
      problems.push({
        where: `node "${key || "(empty)"}"`,
        message: `invalid node key "${key}" (letters, digits, underscores)`,
        nodeKey: key || undefined,
      });
    }
    if (keys.has(key)) {
      problems.push({
        where: `node "${key}"`,
        message: `duplicate node key "${key}"`,
        nodeKey: key,
      });
    }
    const ntId = n.nodeTemplateId?.trim() ?? "";
    if (!ntId) {
      problems.push({
        where: `node "${key}"`,
        message: `node "${key}" is missing its node template`,
        nodeKey: key,
      });
    }
    const nt = ntId ? resolveNodeTemplate(n) : null;
    if (ntId && !nt) {
      problems.push({
        where: `node "${key}"`,
        message: `unknown node template for "${key}"`,
        nodeKey: key,
      });
    }
    if (nt?.isBuiltin && key !== nt.key) {
      problems.push({
        where: `node "${key}"`,
        message: `built-in instances must use the key "${nt.key}"`,
        nodeKey: key,
      });
    }
    if (key) {
      keys.add(key);
      if (nt) kindByKey.set(key, nt.kind);
    }
  }

  const normalizedEdges: {
    from: string;
    to: string;
    kind: "next" | "loop";
    label: string | null;
    condition: string | null;
    edgeIndex: number;
  }[] = [];

  const seenDedupe = new Set<string>();
  for (const [i, e] of (edges ?? []).entries()) {
    if (!keys.has(e.from)) {
      problems.push({
        where: `edge ${e.from} → ${e.to}`,
        message: `edge from unknown node "${e.from}"`,
        edgeIndex: i,
      });
    }
    if (!keys.has(e.to)) {
      problems.push({
        where: `edge ${e.from} → ${e.to}`,
        message: `edge to unknown node "${e.to}"`,
        edgeIndex: i,
      });
    }
    if (e.from === e.to) {
      problems.push({
        where: `edge ${e.from} → ${e.to}`,
        message: `self-edge on "${e.from}"`,
        edgeIndex: i,
      });
    }
    const kind = e.kind === "loop" ? "loop" : "next";
    const label = e.label?.trim() || null;
    const dedupe = edgeDedupeKey(e.from, e.to, label);
    if (seenDedupe.has(dedupe)) {
      problems.push({
        where: `edge ${e.from} → ${e.to}`,
        message: `duplicate edge ${e.from} → ${e.to}${label ? ` (${label})` : ""}`,
        edgeIndex: i,
      });
    }
    seenDedupe.add(dedupe);

    const sourceKind = kindByKey.get(e.from);
    if (label && sourceKind && sourceKind !== "decision") {
      problems.push({
        where: `edge ${e.from} → ${e.to}`,
        message: "branch labels are only allowed on decision out-edges",
        edgeIndex: i,
      });
    }
    if (e.condition?.trim() && sourceKind === "decision" && kind === "next") {
      problems.push({
        where: `edge ${e.from} → ${e.to}`,
        message: "decision branches are chosen by label, not edge conditions",
        edgeIndex: i,
      });
    }

    normalizedEdges.push({
      from: e.from,
      to: e.to,
      kind,
      label,
      condition: e.condition?.trim() || null,
      edgeIndex: i,
    });
  }

  for (const n of nodes) {
    const key = (n.key ?? "").trim();
    const nt = resolveNodeTemplate(n);
    if (!nt || nt.kind !== "decision") continue;
    const choices = new Set(nt.decisionChoices ?? []);
    const outEdges = normalizedEdges.filter((e) => e.from === key && e.kind === "next");
    if (!outEdges.length) {
      problems.push({
        where: `node "${key}"`,
        message: `decision node "${key}" needs at least one outgoing edge`,
        nodeKey: key,
      });
    }
    for (const e of outEdges) {
      if (!e.label) {
        problems.push({
          where: `edge ${e.from} → ${e.to}`,
          message: `edge ${e.from} → ${e.to} out of decision "${key}" needs a branch label`,
          edgeIndex: e.edgeIndex,
        });
      } else if (choices.size && !choices.has(e.label)) {
        problems.push({
          where: `edge ${e.from} → ${e.to}`,
          message: `edge ${e.from} → ${e.to} label "${e.label}" is not one of decision "${key}"'s choices (${[...choices].join(", ")})`,
          edgeIndex: e.edgeIndex,
        });
      }
    }
  }

  const nextAdj = new Map<string, string[]>();
  for (const e of normalizedEdges) {
    if (e.kind !== "next") continue;
    const list = nextAdj.get(e.from) ?? [];
    list.push(e.to);
    nextAdj.set(e.from, list);
  }
  if (hasNextEdgeCycle(keys, nextAdj)) {
    problems.push({ where: "template", message: NEXT_CYCLE_MESSAGE });
  }

  return problems;
};

const hasNextEdgeCycle = (keys: Set<string>, adj: Map<string, string[]>): boolean => {
  const state = new Map<string, 0 | 1 | 2>();
  for (const k of keys) state.set(k, 0);

  const visit = (k: string): boolean => {
    const s = state.get(k) ?? 0;
    if (s === 1) return true;
    if (s === 2) return false;
    state.set(k, 1);
    for (const next of adj.get(k) ?? []) {
      if (visit(next)) return true;
    }
    state.set(k, 2);
    return false;
  };

  for (const k of keys) {
    if ((state.get(k) ?? 0) === 0 && visit(k)) return true;
  }
  return false;
};

export const graphStructureError = (problems: LintProblem[]): string | null =>
  problems.length
    ? problems.map((p) => (p.where ? `${p.where}: ${p.message}` : p.message)).join("\n")
    : null;
