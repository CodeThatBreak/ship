import "server-only";

import { db } from "../../../db/app";
import { EVENT_KIND } from "../../constants/vocabulary";
import { InputContractError } from "../../errors/inputContractError";
import { buildFlowContext } from "../../context/flowVariables";
import { engineParts } from "@/lib/composition/container";
import { templateStore } from "../../templates/templateStore";
import { nodeRegistry } from "../../nodes/registry";
import { parseStartContract, validateAgainstContract } from "../../nodes/kinds/start/contract";
import { evalInputMapOver } from "../staging/utils/evalInputMap";
import type { StageGateOutcome } from "../staging/types/stageGate";
import { subflowDefOf } from "./utils/subflowDefOf";
import { isRecord } from "./utils/isRecord";
import type { SubflowChildPayload } from "./types/subflowChildPayload";
import type { SubflowEngineSurface } from "./types/subflowEngineSurface";
import type { SubflowJoin } from "./subflowJoin";

/**
 * SubflowExpander — the subflow runtime's stage gate and expansion (task 26,
 * design §7, finding B4): decides whether a node's stage belongs to the
 * subflow runtime (a declarative `subflow` node with a `child` configured),
 * expands ONE child flow via the existing `createStepChild` path
 * (start-contract-validated payload from the node's `input_map` — the same
 * validation `flowFactory.createStepChild` runs, re-checked here first so a
 * mismatch fails loudly BEFORE any child row exists), and hands the child to
 * the engine's start.
 *
 * Invariants upheld:
 * - The gate engages ONLY on a declarative `subflow` node with a configured
 *   child — relevance from config-or-linkage, never a def key (Invariant F1).
 * - No nesting: a child flow never delegates again (the fan-out lint rule's
 *   runtime mirror) — the gate skips and the def run fails loudly instead.
 * - The child template resolves and its start contract validates BEFORE any
 *   child row exists — a producer error throws loudly and the stage's catch
 *   fails the node typed (the split expander's rule).
 * - Invariant 8: the expansion claims nothing itself — the stage claim
 *   already happened; the rollup owns the follow-on through the registered
 *   `onChildTerminal` effect.
 *
 * Must never:
 * - write `nodes.status` or publish transitions (the gate only creates the
 *   child row and starts it);
 * - import the flowEngine value directly (the singleton cycle resolves
 *   through the bound `SubflowEngineSurface`).
 */
export class SubflowExpander {
  constructor(
    private readonly engine: () => SubflowEngineSurface,
    private readonly join: SubflowJoin,
  ) {}

  private get e(): SubflowEngineSurface {
    return this.engine();
  }

  /**
   * The subflow runtime's stage-ownership gate: `"own"` when this runtime
   * expanded the one delegated child (the def run is skipped), `"run"` when
   * the node is not a configured subflow node (the frozen whole path).
   */
  async gate(flowId: string, nodeKey: string): Promise<StageGateOutcome> {
    const config = await this.e.nodeConfigFor(flowId, nodeKey);
    const child = typeof config.child === "string" && config.child.trim() ? config.child.trim() : null;
    if (child == null) return "run"; // not configured — the frozen default
    // §T3 metadata routing: the def's subflowDelegation port, never a
    // literal def key — only the subflow def hands its stage to this runtime
    const def = await this.e.defOf(flowId, nodeKey);
    if (!def.subflowDelegation) return "run";
    if (await this.e.isStepChild(flowId)) return "run"; // no nesting — the def run fails loudly
    subflowDefOf(config, nodeKey); // loud on a malformed config
    await this.expand(flowId, nodeKey, child);
    return "own";
  }

  /**
   * Expand ONE child flow from the configured child template and start it.
   * The payload is the node's materialized input (inherited upstream outputs
   * + the `input_map` overlay — the same evaluation the def run would have
   * performed), validated against the child's declared start contract before
   * any child row exists.
   */
  private async expand(parentFlowId: string, nodeKey: string, templateId: string): Promise<void> {
    const childGraph = await templateStore.graph(templateId);
    if (!childGraph?.nodes.length) {
      throw new Error(`subflow: child template "${templateId}" has no nodes (the ${nodeKey} node's child config)`);
    }
    const templateName = (await templateStore.flowTemplate(templateId))?.name ?? templateId;
    const ctx = await this.e.ctx(parentFlowId);
    const spec = (await templateStore.graphForFlow(parentFlowId))?.byKey.get(nodeKey);
    // the materialized input the def run would have seen (shared evaluator)
    const mapped = await evalInputMapOver({
      nodeKey,
      rawInput: await this.e.inheritedInput(parentFlowId, nodeKey, ctx),
      ctxMap: await buildFlowContext(ctx),
      inputMap: spec?.inputMap,
    });
    // Invariant 5 seam: the same input validation runNode performs — a
    // declarative node's input_map targets must materialize
    const def = await this.e.defOf(parentFlowId, nodeKey);
    try {
      engineParts.contracts.validateInput(def, mapped, { inputMap: spec?.inputMap });
    } catch (e: unknown) {
      if (e instanceof InputContractError) {
        await engineParts.events.emit(parentFlowId, nodeKey, EVENT_KIND.INPUT_CONTRACT_VIOLATION, e.message,
          { nodeKey, field: e.missingField, ...(e.producerKey != null ? { producer: e.producerKey } : {}) });
      }
      throw e;
    }
    // the start contract validates BEFORE any child row exists — the same
    // parse+validate `flowFactory.createStepChild` runs (and the child's own
    // Start node re-validates the persisted payload). An empty contract
    // validates nothing (the fan-out guard) — the mapped input rides as-is.
    const input = isRecord(mapped) ? mapped : {};
    const startSpec = childGraph.nodes.find((n) => n.defKey === nodeRegistry.entryKey());
    const contractFields = startSpec ? parseStartContract(startSpec.config) : [];
    if (contractFields.length) {
      const v = validateAgainstContract(contractFields, input);
      if (!v.ok) {
        throw new Error(
          `subflow: the delegated input doesn't match the child template "${templateName}" start contract — ${v.error}`);
      }
      // contract-clean children carry only their contract fields (the
      // linkage derives at rollup time); contract-free children ride the
      // linkage in the payload
      const payload: SubflowChildPayload = { ...v.values };
      await this.handOff(parentFlowId, nodeKey, templateId, templateName, payload);
      return;
    }
    await this.handOff(parentFlowId, nodeKey, templateId, templateName, {
      ...input, parentNodeKey: nodeKey, subflow: { child: templateId },
    });
  }

  /** Create the one child flow, fence its rollup to this attempt, and start it. */
  private async handOff(
    parentFlowId: string,
    nodeKey: string,
    templateId: string,
    templateName: string,
    payload: SubflowChildPayload,
  ): Promise<void> {
    const ctx = await this.e.ctx(parentFlowId);
    const spec = (await templateStore.graphForFlow(parentFlowId))?.byKey.get(nodeKey);
    const name = `${ctx.flow.name} · subflow: ${spec?.label ?? nodeKey}`;
    const childId = await this.e.createStepChild(parentFlowId, templateId, name, payload, { branch: null });
    const attemptId = (await db.prisma.node.findFirst({ where: { flowId: parentFlowId, nodeKey }, select: { attemptId: true } }))?.attemptId;
    if (attemptId) this.join.captureAttempt(childId, attemptId);
    await db.emitEvent(parentFlowId, null, "lifecycle",
      `subflow: ${nodeKey} delegates to child flow "${templateName}"`,
      { nodeKey, childFlowId: childId, childTemplate: templateId });
    await this.e.startStepChild(childId);
  }
}
