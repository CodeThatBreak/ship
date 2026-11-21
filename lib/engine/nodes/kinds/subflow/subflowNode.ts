import "server-only";

import type { NodeRow } from "../../../../db/rows";
import type { AgentRunResult } from "../../../ports/agentPort";
import type { RecoveryResult } from "../../shared/types/recovery";
import { NODE_KEYS } from "../../../constants/nodeKeys";
import type { FlowCtx, NodeTriggerRun, RunOutcome } from "../../shared/nodeSharedExports";
import { NodeDefinition } from "../../shared/nodeDefinition";
import { SubflowDefSchema, type SubflowDef } from "../../schemas/declarativeSchemas";
import { SubflowRunInput, SubflowFreeOutput } from "./schema";
import { SUBFLOW_CONFIG_FIELDS } from "./constants/subflowConfigFields";

/**
 * The subflow node (task 26, design §7, finding B4): ONE delegated child
 * flow as a small addition on the StageGateRegistry, not a new runtime.
 *
 * The def is declarative-shaped — its config IS `SubflowDefSchema`
 * (`{child, parallel_max, pass}`, the same schema box the declarative kinds
 * use) and it renders through the generic config form/panel — but it
 * registers as a built-in def: the `node_templates.kind` column is the
 * sticky Prisma `NodeTemplateKind` enum, which cannot carry a `"subflow"`
 * value without a migration (AGENTS §1 — enum values are sticky, add only
 * when forced). The gate dispatches on the `subflowDelegation` metadata
 * port, never a literal def key (§T3).
 *
 * The def itself never runs the delegation: the registered stage gate owns
 * the node's stage (expands the child via the existing `createStepChild`
 * path and returns `"own"`, so the def's run is skipped). This run body is
 * reached only when the gate could NOT engage — no `child` configured, or
 * the flow is itself a child flow (delegation does not nest, the fan-out
 * rule's mirror) — and it fails loudly with the reason, never silently
 * publishes an empty success.
 *
 * The child's terminal output (or the declared `pass` mapping) publishes as
 * this node's aggregate through the runtime's `onChildTerminal` rollup
 * (Invariant 8: an effect owns the follow-on) — the node's own output
 * contract stays the free record the rollup publishes into.
 */
export class SubflowNode extends NodeDefinition<Record<string, unknown>, Record<string, unknown>> {
  readonly key = NODE_KEYS.SUBFLOW;
  readonly label = "Subflow";
  readonly promptKeys = [] as const;
  /** after the resolve node — the last built-in in graph order */
  readonly order = 60;
  override readonly retryable = true;

  /** the declarative subflow delegation port (§T3) — the stage gate's dispatch flag */
  override readonly subflowDelegation = true;

  readonly inputSchema = SubflowRunInput;
  readonly outputSchema = SubflowFreeOutput;

  /** no declared input contract — the input is the previous node's output */
  override readonly inheritsParentInput = true;

  override readonly configSchema = SubflowDefSchema;

  override readonly configFields = SUBFLOW_CONFIG_FIELDS;

  /**
   * The gate owns the stage — a run reaching here means the expansion could
   * not engage. The two reasons are distinguishable on purpose: a missing
   * `child` is an authoring gap (fix the config), a nested flow is a graph
   * rule violation (restructure the template). Both fail the node loudly.
   */
  async run(ctx: FlowCtx, rawInput: Record<string, unknown>, config: Record<string, unknown>): Promise<RunOutcome> {
    const cfg = SubflowDefSchema.parse(config ?? {}) as SubflowDef;
    await this.markRunning(ctx, { ...(rawInput ?? {}) });
    const reason = cfg.child == null
      ? `${this.label}: no child template configured — set child in the template editor`
      : `${this.label}: the subflow stage is owned by the expansion gate — a run here means the flow is itself a child flow, and delegation does not nest`;
    return await this.applyOutcome(ctx, {
      status: "failed",
      output: {},
      event: `${this.label} failed`,
      eventData: { error: reason },
      reply: reason,
    });
  }

  /** Restart recovery: the delegation is the gate's, not a run's — a
   *  completed run cannot be re-materialized (the fixed recovery ABI). */
  async recover(_ctx: FlowCtx, _node: NodeRow, result: AgentRunResult, _note: string): Promise<RecoveryResult> {
    void _note;
    if (result.status !== "finished") {
      return { kind: "manual", reason: `the subflow run ended with ${result.status}` };
    }
    return { kind: "manual", reason: "a subflow node's stage belongs to the expansion gate — retry re-enters the gate, not the run" };
  }

  /** The engine's auto-start input: the inherited upstream outputs (the
   *  subflow node declares no input contract — the expansion gate
   *  materializes the same input through the shared evaluator). */
  override async triggerRuns(_ctx: FlowCtx): Promise<NodeTriggerRun[]> {
    void _ctx;
    return [{ input: {} }];
  }
}
