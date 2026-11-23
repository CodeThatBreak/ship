import "server-only";

import type { LintProblem } from "@/types/templateLint";
import type { AddressesOutput, LintNode, NodeContract, TaskUniverse } from "./lintTypes";

const ROOTS = ["task", "repo", "flow", "trigger", "nodes", "input", "secrets"] as const;

interface LintCtx {
  problems: LintProblem[];
  byKey: Map<string, LintNode>;
  contractOfKey: Map<string, NodeContract>;
  addressesOutput: AddressesOutput;
  inHttp: boolean;
  /** the checked node's inherited input fields (parents' merged contracts;
   *  null = free-form — any field passes) */
  inheritedFields: string[] | null;
  /** the template's declared task type → provider fields (null = unknown) */
  task: TaskUniverse | null;
  /** machine coordinate (Phase 5): every problem lintRef stamps carries the
   *  checked node's key for the canvas badges / drawer jump */
  nodeKey?: string;
}

/** Validate one `{{...}}` template reference against the template's known roots,
 *  contracts and task universe. */
export const lintRef = (where: string, ref: string, ctx: LintCtx): void => {
  const stamp = ctx.nodeKey ? { nodeKey: ctx.nodeKey } : {};
  const segments = ref.split(".");
  const root = segments[0];
  if (!(ROOTS as readonly string[]).includes(root)) {
    ctx.problems.push({
      where,
      ref,
      message: `unknown reference {{${ref}}} — roots: task.* | repo.* | flow.* | trigger.payload.* | nodes.<key>.output.* | input.* (the upstream nodes' output)${root === "secrets" ? " | secrets.* (http nodes only)" : ""}`,
      ...stamp,
    });
    return;
  }
  if (root === "secrets" && !ctx.inHttp) {
    ctx.problems.push({
      where,
      ref,
      message: `{{secrets.*}} resolves only inside http node config (URL / headers / body) — secret values never persist`,
      ...stamp,
    });
    return;
  }
  if (root === "task") {
    lintTaskRef(where, segments, ref, ctx);
    return;
  }
  if (root === "input") {
    // the inherited run input — the upstream parents' merged output contract
    const field = segments[1];
    if (!field) return; // bare {{input}} renders the whole inherited object
    if (ctx.inheritedFields == null) return; // free-form — any field passes
    if (!ctx.inheritedFields.includes(field)) {
      ctx.problems.push({
        where,
        ref,
        message: `the node's upstream publishes ${ctx.inheritedFields.length ? JSON.stringify(ctx.inheritedFields) : "no declared fields"} — not "${field}"`,
        ...stamp,
      });
    }
    return;
  }
  if (root === "nodes") {
    const nodeKey = segments[1];
    if (!nodeKey || !ctx.byKey.has(nodeKey)) {
      ctx.problems.push({
        where,
        ref,
        message: `{{${ref}}} references unknown node "${nodeKey ?? ""}"`,
        ...stamp,
      });
      return;
    }
    const contract = ctx.contractOfKey.get(nodeKey);
    if (contract?.kind === "decision" && segments[2] === "output" && contract.fields != null && !contract.fields.includes(segments[3])) {
      ctx.problems.push({
        where,
        ref,
        message: `node "${nodeKey}" (decision) publishes ${contract.fields.join(" / ")}, not "${segments[3] ?? ""}"`,
        ...stamp,
      });
      return;
    }
    // the machinery addresses `<key>.output.<field>` — the ref's `nodes.`
    // root segment is the lookup namespace, not part of the address
    ctx.addressesOutput(segments.slice(1).join("."), (field) => ctx.problems.push({
      where,
      ref,
      message: `node "${nodeKey}" publishes ${field === "markdown" ? '{"markdown"}' : "fields " + JSON.stringify(ctx.contractOfKey.get(nodeKey)?.fields) + " — not .${field}"}`,
      ...stamp,
    }));
  }
};

/**
 * The {{task.*}} universe: the template's declared task type's provider
 * `contextFields`. An unknown field is a save error (same philosophy
 * as the {{refs}} checks — it would render empty at run time).
 */
const lintTaskRef = (where: string, segments: string[], ref: string, ctx: LintCtx): void => {
  const field = segments[1];
  if (!field) return; // bare {{task}} renders the whole task object
  if (ctx.task && !ctx.task.fields.some((f) => f.key === field)) {
    const published = ctx.task.fields.length
      ? "fields " + JSON.stringify(ctx.task.fields.map((f) => f.key))
      : "no declared fields";
    ctx.problems.push({
      where,
      ref,
      message: `the template's task type ("${ctx.task.kind}") publishes ${published} — not "${field}"`,
      ...(ctx.nodeKey ? { nodeKey: ctx.nodeKey } : {}),
    });
  }
};
