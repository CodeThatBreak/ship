import "server-only";

import { NODE_STATUS, type EngineNodeStatus } from "../constants/nodeStatus";
import { DEFAULT_FANOUT_OUTPUT, DEFAULT_SPLIT_OUTPUT } from "../nodes/shared/schemas/defaultOutputs";
import { InputContractError } from "../errors/inputContractError";
import { OutputContractError } from "../errors/outputContractError";
import { producerKeyOf } from "./utils/contractProducers";
import type { NodeDefinition } from "../nodes/shared/nodeDefinition";

/**
 * ContractPipeline — the input/output contract seam (target-architecture §1
 * and §4, Invariant 5: contracts all the way down).
 *
 * Stage start: the materialized input map is validated against the node's
 * `consumes` schema and against the template node's `input_map` targets (a
 * declarative node's declared upstream needs — the fields its input_map
 * promises, which today can silently vanish when the producing expression
 * resolves to nothing). Failure ⇒ {@link InputContractError}: the stage
 * refuses to proceed and the node fails with a typed
 * `input_contract_violation` naming the field and the producing node.
 *
 * Stage end: a terminal outcome is validated against the node's
 * `outputSchema` before the transition authority writes it. Failure ⇒
 * {@link OutputContractError}: the authority refuses to publish — the caller
 * maps the failure to a `failed` node with a typed
 * `output_contract_violation` event. There is no "publish it unvalidated"
 * path.
 *
 * Must never: validate more than the node declared (the `consumes` check
 * covers only declared fields — never the whole input map against an
 * invented schema), fall back silently on a violation, or publish a
 * success-terminal output that failed its contract.
 */
export class ContractPipeline {
  /**
   * Stage-start check. `materialized` is the post-merge, post-`input_map`
   * input the run would receive. Two declared sources are checked:
   *
   *  - the def's `consumes` schema (built-ins declare the upstream facts
   *    their trigger construction depends on);
   *  - the template node's `input_map` targets (declarative kinds) — each
   *    non-empty mapping's field must actually be present after evaluation,
   *    otherwise the producing expression silently dropped it.
   */
  validateInput(
    node: NodeDefinition,
    materialized: unknown,
    opts: { inputMap?: Record<string, unknown> } = {},
  ): void {
    this.validateConsumes(node, materialized);
    this.validateInputMapTargets(node.key, materialized, opts.inputMap ?? {});
  }

  /** Stage-end check: the raw output against the node's `outputSchema`. */
  validateOutput(node: NodeDefinition, output: unknown): void {
    const result = node.outputSchema.safeParse(output);
    if (!result.success) {
      throw new OutputContractError({
        nodeKey: node.key,
        issues: result.error.issues.map((i) => `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}`),
      });
    }
  }

  /**
   * The authority's terminal-write check, status-aware: success terminals
   * (`done` / `awaiting_approval` / `approved`) must satisfy the output
   * contract; `failed` / `skipped` writes carry no payload data (`{}` or the
   * pre-failure shape) and are exempt — the contract violation itself is what
   * made the node failed, and its detail travels in the typed event.
   */
  validateTerminalOutput(node: NodeDefinition, toStatus: EngineNodeStatus, output: unknown): void {
    if (toStatus === NODE_STATUS.FAILED || toStatus === NODE_STATUS.SKIPPED) return;
    this.validateOutput(node, output);
  }

  /**
   * The fan-out/split aggregate's terminal-write check: the full aggregate
   * output against the def's declared aggregate contract (the
   * `fanoutOutput`/`splitOutput` capability, the generic default otherwise).
   * The runtime managers' failure mapping (typed event + failed node, no
   * advance) lives with their finish paths — the seam only refuses.
   */
  validateAggregateOutput(key: "fanoutOutcome" | "splitOutcome", node: NodeDefinition, output: unknown): void {
    const contract = key === "fanoutOutcome"
      ? node.capabilities.fanoutOutput ?? DEFAULT_FANOUT_OUTPUT
      : node.capabilities.splitOutput ?? DEFAULT_SPLIT_OUTPUT;
    const result = contract.safeParse(output);
    if (!result.success) {
      throw new OutputContractError({
        nodeKey: node.key,
        issues: result.error.issues.map((i) => `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}`),
      });
    }
  }

  /** The def's own `consumes` declaration (built-ins). Empty default = no declared needs. */
  private validateConsumes(node: NodeDefinition, materialized: unknown): void {
    const shape = (node.consumes as unknown as { shape?: Record<string, unknown> }).shape;
    if (!shape || Object.keys(shape).length === 0) return;
    const result = node.consumes.safeParse(materialized ?? {});
    if (result.success) return;
    const issue = result.error.issues[0];
    throw new InputContractError({
      nodeKey: node.key,
      missingField: issue?.path.length ? String(issue.path[0]) : "(input)",
      detail: issue?.message,
    });
  }

  /**
   * The template node's `input_map` targets (declarative kinds): every
   * non-empty mapping promises a field in the materialized input — a missing
   * one means the producing expression resolved to nothing. The producer is
   * attributed best-effort from the expression's `nodes.<key>.output.*`
   * address.
   */
  private validateInputMapTargets(
    nodeKey: string,
    materialized: unknown,
    inputMap: Record<string, unknown>,
  ): void {
    const targets = Object.entries(inputMap)
      .filter(([, expr]) => typeof expr === "string" && (expr as string).trim())
      .map(([field]) => field)
      .filter((field) => field.trim());
    if (!targets.length) return;
    const rec = materialized != null && typeof materialized === "object" && !Array.isArray(materialized)
      ? (materialized as Record<string, unknown>)
      : {};
    for (const field of targets) {
      if (field in rec && rec[field] !== undefined) continue;
      const expr = String(inputMap[field] ?? "").trim();
      throw new InputContractError({
        nodeKey,
        missingField: field,
        producerKey: producerKeyOf(expr),
        detail: expr ? `input_map.${field} ("${expr}") produced no value` : undefined,
      });
    }
  }
}

