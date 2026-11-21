import "server-only";

import { NODE_STATUS } from "../../constants/nodeStatus";
import { EVENT_KIND } from "../../constants/vocabulary";
import { isNodeTerminalSuccess } from "../transitions/constants/statusSets";
import { InputContractError } from "../../errors/inputContractError";
import { parseStartContract } from "../../nodes/kinds/start/contract";
import { nodeRegistry } from "../../nodes/registry";
import { buildFlowContext, type FlowContextMap } from "../../context/flowVariables";
import { evalInputMapOver } from "./utils/evalInputMap";
import type { FlowCtx } from "../../nodes/shared/nodeSharedExports";
import { templateStore, type TemplateGraph } from "../../templates/templateStore";
import { EffectRegistry } from "../effects/effectRegistry";
import { EFFECT_LIFECYCLE } from "../effects/constants/effectLifecycles";
import type { EffectCtx } from "../effects/types/nodeEffects";
import { TRIGGER_SOURCE } from "../triggers/constants/triggerSources";
import type { TransitionEvents } from "../transitions/transitionEvents";
import type { StageRunnerHost } from "../flowEngineHost";
import type { WaitStore } from "../waits/waitStore";
import type { TriggerSource } from "../triggers/types/triggerGateway";
import type { ContractPipeline } from "../contractPipeline";
import { ConditionEvaluator } from "./conditionEvaluator";
import { InputMaterializer } from "./inputMaterializer";
import { LoopJoin } from "./loopJoin";
import type { StageGateRegistry } from "./stageGateRegistry";
import { DEFAULT_LOOP_JOIN_DESCRIPTOR } from "./constants/loopJoin";

/**
 * StageRunner — the engine's stage orchestrator (today's EdgeActivator,
 * renamed; target-architecture §1/§12): template edge activation, join/skip
 * propagation, and auto-start stages. One stage = materialize the input,
 * honor the trigger type's gating (manual/debounced/wait_for sources), claim
 * through the gateway, run the def's trigger runs, and publish the outcome
 * through the authority — then consult the EffectRegistry for what happens
 * after the stage finishes (Invariant 8).
 *
 * Invariants: no chain logic and no fan-out/split special cases here — the
 * runtimes own their expansion gates (delegated, decided inside the runtime)
 * and every post-finish concern is a registry registration; the loop join is
 * the declared descriptor ({ when, resets }), not ad-hoc status writes.
 *
 * Must never: write node status outside the declared keyed transitions, run a
 * manual-trigger node (the panel entries claim their own stages), or decide
 * sequencing the registry (or the template edges) already owns.
 */
export class StageRunner {
  private readonly conditions: ConditionEvaluator;
  private readonly inputs: InputMaterializer;
  private readonly loopJoin: LoopJoin;

  constructor(
    private readonly host: StageRunnerHost,
    private readonly waits: WaitStore,
    private readonly events: TransitionEvents,
    private readonly effects: EffectRegistry,
    private readonly contracts: ContractPipeline,
    private readonly gates: StageGateRegistry,
  ) {
    this.conditions = new ConditionEvaluator(host, events);
    this.inputs = new InputMaterializer(host, events);
    this.loopJoin = new LoopJoin(host);
  }

  private async graph(flowId: string): Promise<TemplateGraph | null> {
    return templateStore.graphForFlow(flowId);
  }

  /** The manual trigger path's input materialization (see InputMaterializer). */
  inheritedInput(flowId: string, nodeKey: string, ctx: FlowCtx): Promise<Record<string, unknown>> {
    return this.inputs.inheritedInput(flowId, nodeKey, ctx);
  }

  async advanceFrom(flowId: string, fromKey: string): Promise<void> {
    const g = await this.graph(flowId);
    if (!g) return;
    const outgoing = g.edges.filter((e) => e.kind !== "loop" || e.condition?.trim())
      .filter((e) => e.from === fromKey);
    if (!outgoing.length) return;

    const fromSpec = g.byKey.get(fromKey);
    const fromNtKind = fromSpec ? await this.conditions.nodeKind(g, fromSpec) : null;
    const chosen = fromNtKind === "decision" ? await this.conditions.decisionChosen(flowId, fromKey) : null;
    const ctx = fromNtKind !== "decision" && outgoing.some((e) => e.condition?.trim())
      ? await buildFlowContext(await this.host.ctx(flowId)) : null;

    for (const e of outgoing) {
      const target = g.byKey.get(e.to);
      if (!target) continue;
      if (!(await this.conditions.edgeActive(flowId, e, { decision: fromNtKind === "decision", chosen, ctx }))) {
        await this.conditions.resolveInactiveTarget(flowId, g, e.to);
        continue;
      }
      if (!(await this.conditions.joinSatisfied(flowId, g, e.to))) continue;
      // loop-edge re-entry: the declared join ({ when, resets }) resets the
      // target and its downstream success-terminal path so the cycle runs
      // again — the descriptor, not ad-hoc status writes (step 07 task 5)
      if (e.kind === "loop") {
        await this.loopJoin.enter(flowId, g, e.to, { ...DEFAULT_LOOP_JOIN_DESCRIPTOR, when: e.condition ?? null });
      }
      await this.startNodeStage(flowId, target.key);
    }
  }

  /**
   * Join evaluation for a target's incoming edges (see ConditionEvaluator) —
   * public because the manual run path checks the join before claiming.
   */
  joinSatisfied(flowId: string, g: TemplateGraph, key: string): Promise<boolean> {
    return this.conditions.joinSatisfied(flowId, g, key);
  }

  /**
   * Run one trigger's node stage inline (sequential `triggerRuns` bundle —
   * e.g. the multi-branch build), then advance past it when it reached a
   * success terminal. Manual triggers are never started here; debounced
   * targets arm their event-source wait.
   *
   * An auto/approval node whose `wait_for` is `webhook` or `timer` does not
   * run when it becomes eligible — it holds at `waiting` until the event
   * source delivers (a hook bound to this (flow, node) at flow creation / a
   * poller-driven timer), then `resumeNodeFromWebhook` / `processWaitTimers`
   * re-enter this stage with `resumeWaiting`. A debounced node with
   * `wait_for: comments` holds the same way — the comment debounce
   * (reset-on-event while armed) fires it. The pipeline gate keeps its inline
   * role (it runs its own wait loop when it runs).
   *
   * `rawInput` overrides the def's `triggerRuns` — the webhook-resume path
   * passes the delivery body as the trigger input.
   *
   * A stage's own failure is contained: the failing node is marked failed and
   * the advance stops there — the error never propagates to the upstream node
   * whose edge activation started this stage (upstream stays done/approved;
   * the downstream failure carries its own failed status + Retry).
   */
  async startNodeStage(
    flowId: string,
    nodeKey: string,
    opts: { rawInput?: unknown; rawPayload?: unknown; resumeWaiting?: boolean; source?: TriggerSource } = {},
  ): Promise<void> {
    const status = await this.host.nodeStatus(flowId, nodeKey);
    if (opts.resumeWaiting ? status !== "waiting" : status !== "pending") return;
    const spec = (await this.graph(flowId))?.byKey.get(nodeKey);
    const tt = spec?.trigger.type ?? "auto";
    const wait = spec?.trigger.waitFor;
    if (tt === "manual") return;
    if (tt === "debounced") {
      // a debounced node holds at `waiting` until its event source's quiet
      // period elapses (the generic wait-timer machinery fires it); without a
      // source it never auto-starts (the SDLC scheduler drives it)
      if (!opts.resumeWaiting) {
        if (wait === "comments") {
          await this.waits.armNodeWait(flowId, nodeKey, wait, await this.waits.debounceMinutesForNode(flowId, nodeKey, spec));
        }
        return;
      }
    }
    // an approval-triggered entry node holds for the user, not for an output
    // review: it publishes nothing until triggered, so the contract values are
    // provided when the user starts it (same entry as a manual entry node)
    if (tt === "approval" && spec?.defKey === nodeRegistry.entryKey() && parseStartContract(spec.config).length) return;
    if (!opts.resumeWaiting && (tt === "auto" || tt === "approval")) {
      // wait_for event sources gate eligibility (§6) — the pipeline source is
      // the built-in gate (it runs its own wait loop when it runs)
      if (wait === "webhook" || wait === "timer") {
        await this.waits.armNodeWait(flowId, nodeKey, wait, spec?.trigger.minutes ?? null);
        return;
      }
    }
    const claimKey = opts.resumeWaiting ? "resumeWait" : "runFromPending";
    // the gateway claim is the duplicate fence (step 06): an auto/resume
    // start that loses the race emits the typed skip event (source-tagged)
    // instead of the old silent ConflictError swallow
    const claim = await this.host.claimTrigger({
      flowId,
      nodeKey,
      source: opts.source ?? TRIGGER_SOURCE.EFFECT,
      key: claimKey,
    });
    if (!claim.started) return;
    try {
      const def = await this.host.defOf(flowId, nodeKey);
      // ── stage-ownership gates (task 24): the registered axis answers "who
      // owns this node's stage" — the fan-out and split runtimes register
      // their gates at engine boot; a third runtime registers and never
      // edits this file (finding E1). "own" = a gate ran the stage (the def
      // run is skipped); { run, afterRun } = the def's normal whole path runs
      // and the gate post-processes its output (the fan-out whole-wrap
      // aggregate — the fan-out knob outranking the split consume, and the
      // shadowed-knob trail event, live inside the gates); every gate
      // answering "run" is the frozen default whole path. The gates claim
      // through the same gateway — only the dispatch indirection moved.
      const gate = await this.gates.resolve(flowId, nodeKey);
      if (gate === "own") return;
      const runs =
        opts.rawInput !== undefined
          ? [{ input: opts.rawInput }]
          : // declarative nodes declare no input contract — the input IS the
            // previous node's output (merged when several edges feed in)
            def.inheritsParentInput
            ? [{ input: await this.inputs.inheritedInput(flowId, nodeKey, await this.host.ctx(flowId)) }]
            : await def.triggerRuns(await this.host.ctx(flowId));
      for (const run of runs) {
        run.before?.();
        await this.host.runNode(flowId, nodeKey, run.input, opts.rawPayload);
        run.after?.();
      }
      if (typeof gate === "object") await gate.afterRun();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // a typed contract violation already emitted its own
      // input_contract_violation event (step 04) — the generic error line
      // would only duplicate it in the feed
      if (!(e instanceof InputContractError)) {
        await this.events.error(flowId, nodeKey, msg, { nodeKey });
      }
      // declared stageError: running → failed, attempt cleared — silently
      // skipped when the node already moved on (the error event carries the
      // failure detail)
      await this.host.setNodeStatus(flowId, nodeKey, "stageError");
      // child-terminal notification (step 07): the registered onChildTerminal
      // effects react to the failed stage — no-op without fan-out/split
      // linkage (the defKey is unresolved here; the runtime-owned wildcard
      // registrations don't need it)
      await this.effects.run(
        EFFECT_LIFECYCLE.ON_CHILD_TERMINAL,
        this.effectCtx(flowId, nodeKey, "", "failed", opts.source),
      );
      return;
    }
    await this.postTerminal(flowId, nodeKey, opts.source);
  }

  /**
   * The post-terminal dispatch (step 07, Invariant 8) — the single place that
   * answers "what happens after this stage finishes": the registered
   * onChildTerminal effects react (fan-out roll-up / split join), then the
   * lifecycle effects for the outcome. An afterSuccess or loopReentry
   * registration that runs owns the follow-on (the SDLC chain's sequencing —
   * it advances the template edges itself); when nothing claims, the default
   * edge walk advances. A failed outcome dispatches afterFailure effects and
   * never advances — the pre-registry behavior.
   *
   * Shared by every path that runs a stage inline outside startNodeStage
   * (the chain's manual entries, the manual run, retry) so the registry —
   * not call ordering — is the only post-terminal mechanism.
   */
  async postTerminal(flowId: string, nodeKey: string, source?: TriggerSource): Promise<void> {
    const status = await this.host.nodeStatus(flowId, nodeKey);
    const defKey = (await this.host.defOf(flowId, nodeKey)).key;
    await this.effects.run(
      EFFECT_LIFECYCLE.ON_CHILD_TERMINAL,
      this.effectCtx(flowId, nodeKey, defKey, status, source),
    );
    if (isNodeTerminalSuccess(status ?? "")) {
      const ctx = this.effectCtx(flowId, nodeKey, defKey, status, source);
      if (await this.effects.run(EFFECT_LIFECYCLE.AFTER_SUCCESS, ctx)) return;
      if (await this.effects.run(EFFECT_LIFECYCLE.LOOP_REENTRY, ctx)) return;
      await this.advanceFrom(flowId, nodeKey);
      return;
    }
    if (status === NODE_STATUS.FAILED) {
      await this.effects.run(
        EFFECT_LIFECYCLE.AFTER_FAILURE,
        this.effectCtx(flowId, nodeKey, defKey, status, source),
      );
    }
  }

  /**
   * Run a node with a validated input payload. The definition is resolved by
   * the node's def key (registry key for built-ins, node_templates id for
   * declarative kinds), and the effective config is layered the same way chat
   * handlers see it: class defaults ← app-settings ← the per-flow config
   * snapshot (nodes.config).
   *
   * The template instance's `input_map` (§3: `{field: JSONata expr}` over the
   * flow context) is evaluated at trigger time and merged over the caller's
   * trigger input — a mapped field wins over the same key in the trigger
   * payload. A failing expression fails the node loudly with the field name.
   *
   * `deliveryPayload` (Phase 4B): when a waiting node is resumed by a webhook
   * delivery, the delivery body becomes `{{trigger.payload}}` for this run —
   * the context (input maps + agent prompt variables) reads the delivery, not
   * the payload that started the flow. Nothing is persisted from it beyond
   * what the run records.
   *
   * Engine internals shared with the SDLC builtin-chain module — not a public API.
   */
  async runNode(flowId: string, nodeKey: string, rawInput: unknown, deliveryPayload?: unknown): Promise<string> {
    const def = await this.host.defOf(flowId, nodeKey);
    const c = await this.host.ctx(flowId);
    const ctx = deliveryPayload !== undefined ? this.ctxWithDelivery(c, deliveryPayload) : c;
    // the context map the input maps evaluate against — with the delivery
    // override when a webhook resumed the run
    const spec = (await this.graph(flowId))?.byKey.get(nodeKey);
    const mapped = await this.evalInputMap(flowId, nodeKey, rawInput, await buildFlowContext(ctx), spec?.inputMap);
    // Invariant 5 (step 04): the stage refuses to proceed on an input that
    // misses the node's declared upstream needs — typed event names field + producer.
    try {
      this.contracts.validateInput(def, mapped, { inputMap: spec?.inputMap });
    } catch (e: unknown) {
      if (e instanceof InputContractError) {
        await this.events.emit(flowId, nodeKey, EVENT_KIND.INPUT_CONTRACT_VIOLATION, e.message,
          { nodeKey, field: e.missingField, ...(e.producerKey != null ? { producer: e.producerKey } : {}) });
      }
      throw e;
    }
    const input = def.parseInput(mapped);
    const config = def.parseRunConfig(await this.host.nodeConfigFor(flowId, nodeKey));
    const outcome = await def.run(ctx, input, config);
    return outcome.reply;
  }

  /** The flow ctx with a webhook delivery body as {{trigger.payload}} (fresh copy — no DB writes). */
  private ctxWithDelivery(c: FlowCtx, deliveryPayload: unknown): FlowCtx {
    return { ...c, flow: { ...c.flow, triggerPayload: deliveryPayload } } as FlowCtx;
  }

  /** The trigger input overlaid with the template node's evaluated input_map. */
  private async evalInputMap(
    flowId: string,
    nodeKey: string,
    rawInput: unknown,
    ctxMap?: FlowContextMap,
    inputMap?: Record<string, unknown>,
  ): Promise<unknown> {
    // the shared evaluator (the subflow expansion gate drives the same one —
    // the gate owns the stage and must materialize the same input the def
    // run would have seen)
    return evalInputMapOver({
      nodeKey,
      rawInput,
      ctxMap,
      inputMap: inputMap ?? (await this.graph(flowId))?.byKey.get(nodeKey)?.inputMap ?? {},
    });
  }

  /** The dispatch context one effect consult carries (identity + lifecycle
   *  trigger; effects read deeper state through their owning module). */
  private effectCtx(
    flowId: string,
    nodeKey: string,
    defKey: string,
    status: string | null,
    source?: TriggerSource,
  ): EffectCtx {
    return {
      flowId,
      nodeKey,
      defKey,
      status,
      output: null,
      source: source ?? TRIGGER_SOURCE.EFFECT,
    };
  }
}
