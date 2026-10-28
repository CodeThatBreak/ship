import { db } from "../db";
import {
  ArtifactRow,
  BranchRow,
  FlowRow,
  NodeRow,
  PlanStepRow,
  RunRow,
  Task,
  rows,
} from "../db/rows";
import { agentPortRegistry, type AgentRunResult } from "./ports/agent-port";
import { hostOf, type HostComment } from "./ports/git-host";
import { nodeSupport, type ChainRole, type FlowCtx } from "./nodes/shared";
import { CHAT_DECLINED, nodeRoles } from "./nodes/shared/node-roles";
import { uncachedInputTokens } from "../usage";
import { nodeRegistry } from "./nodes/registry";
import { NODE_KEYS } from "./constants/node-keys";
import { declarativeDef } from "./nodes/declarative";
import { planSteps, type PlanStepInput } from "./runtime/plan-step-store";
import { NO_TASK_TYPE, SDLC_TEMPLATE_ID, templateStore, type TemplateGraph, type TemplateEdgeSpec } from "./templates/template-store";
import { appLayerConfig, configNumber, mergeConfigLayers, parseConfigSnapshot } from "./templates/node-config";
import { createSdlcChain } from "./nodes/chains/sdlc-chain";
import { buildFlowContext, type FlowContextMap } from "./context/flow-variables";
import { evalJsonata, jsonataTruthy } from "@/lib/jsonata";
import { hookStore } from "./runtime/hook-store";
import { parseStartContract, validateAgainstContract } from "./nodes/kinds/start/contract";
import { DEFAULT_FANOUT_OUTPUT, uiCapabilities, type NodeCapabilities } from "./nodes/shared/capabilities";
import { stepFlows, StepFlowManager, type StepChildPayload } from "./runtime/fanout/step-flow-manager";
import { worktreeManager } from "./runtime/worktree-lifecycle";
import { processSingleton } from "../singleton";

export interface CreateFlowOptions {
  executionMode?: "cloud" | "local";
  repoId?: string;
  /** flow template to snapshot (default: the seeded SDLC loop) */
  templateId?: string;
  /** the trigger payload that started this flow (webhook / schedule, §6) —
   * persisted on the flow and available to input maps as {{trigger.payload}} */
  triggerPayload?: unknown;
  /** the delivery asks for its auto nodes to run immediately (webhook /
   *  schedule starts via startFromTemplate) — manual task-picker starts don't */
  autoStart?: boolean;
}

/** Reserved delivery keys the engine consumes at flow start — never passed to
 *  the start contract: `repo` (the id, cloud URL or registered name of the
 *  repo this flow attaches to) and the execution mode, accepted as
 *  `execution_mode` or its settings-page alias `harness` (local / cloud). */
const REPO_DELIVERY_KEY = "repo";
const EXEC_MODE_DELIVERY_KEY = "execution_mode";
const EXEC_MODE_DELIVERY_ALIAS = "harness";
const EXEC_MODE_VALUES = ["local", "cloud"] as const;

/** Flow-owned tables, in FK-safe delete order (children before `flows`). */
const FLOW_CHILD_TABLES = [
  "step_merges", // parent_flow_id + flow_id — fan-out merge-back records
  "plan_steps", // sub_flow_id → flows (fan-out checklist)
  "events",
  "messages",
  "runs",
  "artifacts",
  "comments",
  "branches",
  "nodes",
  "hooks", // flow-bound inbound webhooks (wait_for nodes)
] as const;

/**
 * The flow orchestrator: flow creation and reads, node triggers, chat routing,
 * plan-step editing, retry / cancel, restart recovery, and git-host
 * webhook/comment ingestion.
 *
 * All node-type-specific behavior lives in the node classes (registry); this
 * class only sequences them and owns cross-node state transitions.
 *
 * Phase 1 (custom flows): every previously-hardcoded chain position
 * ("pipeline", "review", "resolve") is derived from the flow's template graph
 * (see `templateStore`) — no node-key constants here. Edge activation evaluates
 * the template's edges (join all/any, decision labels, JSONata conditions, real
 * re-entry loops) and starts satisfying targets per their trigger type;
 * debounced targets hold at `waiting` until their event source's quiet period
 * elapses. The built-in SDLC flow actions live in the `chains/sdlc-chain.ts`
 * builtin-chain module (pristine plan §2.1–2.2).
 */
export class FlowEngine {
  /** the SDLC builtin chain (approveBuild / panel stage entries) */
  private readonly chain = createSdlcChain(this);

  // ── flow creation / read ─────────────────────────────────────────────────

  create(taskId: string, repoUrl: string, name?: string, opts: CreateFlowOptions = {}): string {
    const task = rows.get(Task, `SELECT * FROM tasks WHERE id=?`, taskId);
    if (!task) throw new Error("task not found — import tasks first");
    const repo = opts.repoId ? db.repoById(opts.repoId) : undefined;
    if (repo) repoUrl = repo.cloud_url;
    const executionMode = opts.executionMode === "local" ? "local" : "cloud";
    if (executionMode === "local" && !repo?.local_path) {
      throw new Error("Local mode requires a repo registered on the Settings page with a local path.");
    }
    // snapshot the flow's node set from the template — running flows are never
    // mutated by later template edits
    const templateId = opts.templateId ?? SDLC_TEMPLATE_ID;
    const graph = templateStore.graph(templateId);
    if (!graph) throw new Error(`unknown flow template: ${templateId}`);
    // the template declares the task TYPE its flows run on (trigger.task_type,
    // Phase 3) — a manual start passing the picked task must match it
    const declaredType = typeof graph.flowTrigger.task_type === "string" ? graph.flowTrigger.task_type : null;
    if (declaredType && task.type !== declaredType) {
      throw new Error(
        `task ${task.key} is a "${task.type}" task but template "${templateStore.flowTemplate(templateId)?.name ?? templateId}" ` +
        `declares "${declaredType}" task context — pick a ${declaredType} task or change the template's task type`);
    }

    const id = db.uid("flow_");
    const ts = db.now();
    db.run(
      `INSERT INTO flows (id,task_id,name,status,repo_url,repo_id,execution_mode,template_id,trigger_payload,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      id, taskId, name ?? `${task.key} flow`, "active", repoUrl, repo?.id ?? null, executionMode,
      graph.templateId, opts.triggerPayload != null ? JSON.stringify(opts.triggerPayload) : null, ts, ts
    );
    // one node row per template instance spec (template order), config merged
    // from class defaults ← app settings ← template node config
    for (const spec of graph.nodes) {
      const def = nodeRegistry.resolve(spec.defKey, spec.key);
      const config = mergeConfigLayers(def.defaultConfig(), appLayerConfig(def.key), spec.config);
      db.run(
        `INSERT INTO nodes (id,flow_id,node_key,type,label,config,join_mode,status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,'pending',?,?)`,
        db.uid("node_"), id, spec.key, spec.defKey,
        spec.label === def.label ? null : spec.label,
        JSON.stringify(config), spec.joinMode, ts, ts
      );
      // wait_for webhook nodes get their own inbound hook bound to the flow
      // instance (Phase 4B) — the delivery resumes the node
      if (spec.trigger.wait_for === "webhook") hookStore.ensureForNode(id, spec.key);
    }
    // no "flow created" announcement event — the chat feed starts with the
    // user's first message instead of boilerplate
    // webhook/schedule flow triggers auto-start their auto nodes (§6) — a
    // manual trigger template keeps today's explicit startPlan entry, except
    // when the entry node itself declares an `auto` trigger: the user's pick
    // on the home page IS the manual step, and the auto trigger runs the
    // entry straight away with the contract's authored defaults (§5)
    if (opts.autoStart) {
      this.start(id);
    } else {
      const entryKey = nodeRegistry.entryKey();
      const entry = entryKey ? graph.nodes.find((n) => n.defKey === entryKey) : undefined;
      if (entry?.trigger.type === "auto") this.start(id);
    }
    return id;
  }

  // ── plan fan-out: step-child machinery (StepFlowManager internals) ────────

  /**
   * Create a step-child flow with the parent's snapshot machinery — the same
   * shape as create() (snapshot + merged node configs), minus the standalone
   * start validation a user start needs: no task-type check (the task is
   * inherited), no entry-contract gate (the auto-wrapped/step child templates
   * declare no start node), and the fan-out linkage columns set
   * (`parent_flow_id`, `kind: 'step'`, the `{plan, step, siblings}` payload
   * persisted as the trigger payload — which is exactly what makes
   * `{{trigger.payload.step.*}}` work in child input maps / prompt vars, and
   * what carries the rollup's `parentNodeKey`).
   * StepFlowManager internal — not a public API.
   */
  createStepChild(
    parentFlowId: string,
    templateId: string,
    name: string,
    payload: StepChildPayload,
    opts: { branch: string | null }
  ): string {
    const parent = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, parentFlowId);
    if (!parent) throw new Error(`parent flow ${parentFlowId} not found`);
    const graph = templateStore.graph(templateId);
    if (!graph) throw new Error(`unknown flow template: ${templateId}`);
    // Phase 3C (§2): when the child template DECLARES a start contract, the
    // `{plan, step, siblings}` payload is validated against it exactly like a
    // webhook delivery (unknown fields rejected, missing required fields fail
    // loudly). Auto-wrapped / step-build templates declare no start node, so
    // the payload flows straight into input mapping and prompt variables.
    const startSpec = graph.nodes.find((n) => n.defKey === nodeRegistry.entryKey());
    const contractFields = startSpec ? parseStartContract(startSpec.config) : [];
    if (contractFields.length) {
      const v = validateAgainstContract(contractFields, payload);
      if (!v.ok) {
        throw new Error(
          `payload doesn't match the step child's start contract (template "${templateStore.flowTemplate(templateId)?.name ?? templateId}") — ${v.error}`);
      }
    }
    const id = db.uid("flow_");
    const ts = db.now();
    db.run(
      `INSERT INTO flows (id,task_id,name,status,repo_url,repo_id,execution_mode,template_id,trigger_payload,mr_branch,parent_flow_id,kind,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, parent.task_id, name, "active", parent.repo_url, parent.repo_id, parent.execution_mode,
      graph.templateId, JSON.stringify(payload), opts.branch, parentFlowId, "step", ts, ts
    );
    for (const spec of graph.nodes) {
      const def = nodeRegistry.resolve(spec.defKey, spec.key);
      const config = mergeConfigLayers(def.defaultConfig(), appLayerConfig(def.key), spec.config);
      db.run(
        `INSERT INTO nodes (id,flow_id,node_key,type,label,config,join_mode,status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,'pending',?,?)`,
        db.uid("node_"), id, spec.key, spec.defKey,
        spec.label === def.label ? null : spec.label,
        JSON.stringify(config), spec.joinMode, ts, ts
      );
    }
    db.emitEvent(id, null, "lifecycle",
      `step child created from "${templateStore.flowTemplate(templateId)?.name ?? templateId}" — parent flow ${parentFlowId}`);
    return id;
  }

  /**
   * Start a step child's automatic nodes once (bg-wrapped start()). Safe to
   * call again: startNodeStage refuses nodes that aren't `pending` anymore.
   * StepFlowManager internal — not a public API.
   */
  startStepChild(childFlowId: string): void {
    this.bg(childFlowId, null, async () => this.start(childFlowId));
  }

  /**
   * Publish a fan-out node's terminal state (StepFlowManager internals — not a
   * public API): persist the aggregate output, move the node to its
   * trigger-type terminal (approval ⇒ `awaiting_approval` — the SDLC build's
   * final aggregate approval flows through the untouched approveBuild chain →
   * MR creation), then continue the normal edge evaluation on a success
   * terminal.
   */
  async finishFanout(parentFlowId: string, nodeKey: string, output: Record<string, unknown>): Promise<void> {
    const def = this.defOf(parentFlowId, nodeKey);
    // the aggregate `steps` array validates against the def's fanoutOutput
    // contract when one is published (default shape otherwise); the parent's
    // native fields (branch / latestArtifact) ride alongside it
    const fanoutContract = (def.capabilities as NodeCapabilities | undefined)?.fanoutOutput;
    let steps: unknown = output.steps ?? [];
    try {
      steps = ((fanoutContract ?? DEFAULT_FANOUT_OUTPUT).parse({ steps }) as { steps?: unknown })?.steps ?? steps;
    } catch (e: unknown) {
      db.emitEvent(parentFlowId, null, "error",
        `${nodeKey}: the fan-out aggregate failed its output contract — publishing it unvalidated (${e instanceof Error ? e.message : e})`,
        { nodeKey });
    }
    const tt = this.graph(parentFlowId)?.byKey.get(nodeKey)?.trigger.type ?? "auto";
    const status = tt === "approval" ? "awaiting_approval" : "done";
    db.run(
      `UPDATE nodes SET status=?, output=?, updated_at=? WHERE flow_id=? AND node_key=?`,
      status, JSON.stringify({ ...output, steps }), db.now(), parentFlowId, nodeKey);
    db.emitEvent(parentFlowId, db.get<{ id: string }>(
      `SELECT id FROM nodes WHERE flow_id=? AND node_key=?`, parentFlowId, nodeKey)?.id ?? null,
      "lifecycle",
      `${nodeKey} fan-out resolved — aggregate published (${(steps as unknown[])?.length ?? 0} steps)${status === "awaiting_approval" ? " · awaiting the final approval" : ""}`,
      { nodeKey });
    this.touch(parentFlowId);
    if (this.statusTerminalSuccess(status)) {
      await this.advanceFrom(parentFlowId, nodeKey);
    }
    this.clearCurrentIf(parentFlowId, nodeKey);
  }

  get(id: string) {
    const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, id);
    if (!flow) return null;
    const task = rows.get(Task, `SELECT * FROM tasks WHERE id=?`, flow.task_id);

    // per-run cost/usage rows, rolled up per node + flow total
    const runs = rows.all(RunRow,
      `SELECT * FROM runs WHERE flow_id=? ORDER BY created_at, id`, id);
    const nodeCosts = new Map<string, { totalCents: number; tokens: number; runs: RunRow[] }>();
    for (const r of runs) {
      const c = nodeCosts.get(r.node_id) ?? { totalCents: 0, tokens: 0, runs: [] };
      if (r.cost_cents != null) c.totalCents += r.cost_cents;
      // stored input_tokens is the full prompt for local runs (cache reads are
      // a subset of it) — roll up the overlap the same way the cost estimator does
      c.tokens += uncachedInputTokens({
        inputTokens: r.input_tokens,
        cacheReadTokens: r.cache_read_tokens,
        cacheWriteTokens: r.cache_write_tokens,
      }) + (r.output_tokens ?? 0) +
        (r.cache_read_tokens ?? 0) + (r.cache_write_tokens ?? 0);
      c.runs.push(r);
      nodeCosts.set(r.node_id, c);
    }
    const flowCost = {
      totalCents: [...nodeCosts.values()].reduce((s, c) => s + c.totalCents, 0),
      tokens: [...nodeCosts.values()].reduce((s, c) => s + c.tokens, 0),
      runCount: runs.length,
    };
    // plan fan-out (Phase 4): the step children's own runs ARE each step's
    // cost/duration — one query over the whole checklist, keyed by child flow
    // id, then folded into the flow total (a fanned-out parent node has no
    // direct runs; the header cost would otherwise read ~0 while the work runs)
    const stepRunStats = new Map<string, { costCents: number; tokens: number; durationMs: number; runCount: number }>();
    const branches = rows.all(BranchRow, `SELECT * FROM branches WHERE flow_id=? ORDER BY "order", created_at`, id);
    // plan fan-out merge-back state — ONE pass for the whole checklist
    // (Phase 3A: hoisted out of the per-step map, was O(k²) reads)
    const mergeStateMap = stepFlows.mergeStates(id);
    const steps = rows.all(PlanStepRow, `SELECT * FROM plan_steps WHERE flow_id=? ORDER BY position, created_at`, id)
      .map((s) => ({ ...s, files: s.files ?? [] }));
    // per-step cost/usage: group the children's runs (keyed by child flow id)
    // and fold them into the flow total — Phase 4 monitoring (cards, rollup,
    // graph subtitle, header run summary)
    const childFlowIds = steps.map((s) => s.sub_flow_id).filter((v): v is string => Boolean(v));
    if (childFlowIds.length) {
      const childRuns = rows.all(RunRow,
        `SELECT * FROM runs WHERE flow_id IN (${childFlowIds.map(() => "?").join(",")}) ORDER BY created_at, id`,
        ...childFlowIds);
      for (const r of childRuns) {
        const c = stepRunStats.get(r.flow_id) ?? { costCents: 0, tokens: 0, durationMs: 0, runCount: 0 };
        if (r.cost_cents != null) c.costCents += r.cost_cents;
        if (r.duration_ms != null) c.durationMs += r.duration_ms;
        c.tokens += uncachedInputTokens({
          inputTokens: r.input_tokens,
          cacheReadTokens: r.cache_read_tokens,
          cacheWriteTokens: r.cache_write_tokens,
        }) + (r.output_tokens ?? 0) +
          (r.cache_read_tokens ?? 0) + (r.cache_write_tokens ?? 0);
        c.runCount++;
        stepRunStats.set(r.flow_id, c);
      }
      // the flow total includes the step sub-flows (a fanned-out parent node
      // has no direct runs — the honest spend would otherwise read ~0)
      for (const c of stepRunStats.values()) {
        flowCost.totalCents += c.costCents;
        flowCost.tokens += c.tokens;
        flowCost.runCount += c.runCount;
      }
    }
    const stepsEnriched = steps
      // plan fan-out: attached per-step child state keeps the parent panels off
      // N+1 side calls — the card links straight to the child flow screen
      .map((s) => {
        if (!s.sub_flow_id) return s;
        const child = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, s.sub_flow_id);
        if (!child) return s;
        const childNodes = rows.all(NodeRow, `SELECT * FROM nodes WHERE flow_id=? ORDER BY created_at`, s.sub_flow_id);
        // the owning fan-out node key from the child's payload — what the
        // graph subtitle / step card rollup keys on
        let parentNodeKey: string | null = null;
        try {
          const p = child.trigger_payload ?? {};
          parentNodeKey = typeof p.parentNodeKey === "string" ? p.parentNodeKey : null;
        } catch { parentNodeKey = null; }
        // Phase 2 merge-back state (conflict / fixing / stale base chips)
        const ms = mergeStateMap[s.sub_flow_id] ?? null;
        return {
          ...s,
          sub_flow: {
            id: child.id,
            name: child.name,
            status: child.status,
            branch: child.mr_branch,
            nodeStatus: StepFlowManager.childRollup(childNodes.map((n) => n.status), child.status),
            nodeKey: childNodes[0]?.node_key ?? null,
            parentNodeKey,
            // Phase 4 cost/duration rollup: the child flow's own run rows
            // (cards show cost + duration per step; zeroed when it has no runs)
            ...(stepRunStats.get(s.sub_flow_id!) ?? { costCents: 0, tokens: 0, durationMs: 0, runCount: 0 }),
            mergeStatus: ms?.mergeStatus ?? null,
            mergeAttempts: ms?.mergeAttempts ?? 0,
            mergeError: ms?.mergeError ?? null,
            staleBase: ms?.staleBase ?? false,
          },
        };
      });

    // node order comes from the flow's own template (snapshot), not the global
    // registry — templates may order and label nodes differently
    const order = templateStore.graphForFlow(id)?.nodes.map((n) => n.key) ?? nodeRegistry.order();
    // catalog identity per node instance (kind/icon for the UI's generic panel)
    const ntRows = db.all<{ id: string; key: string; name: string; kind: string; icon: string | null; is_builtin: number }>(
      `SELECT id, key, name, kind, icon, is_builtin FROM node_templates`
    );
    const ntOf = (type: string) =>
      ntRows.find((r) => r.id === type || (r.is_builtin && r.key === type)) ?? null;
    return {
      ...flow,
      cost: flowCost,
      branches,
      planSteps: stepsEnriched,
      resolveScheduleAt: this.resolveScheduleAt(id),
      task: task ?? null,
      hooks: hookStore.hooksForFlow(id),
      nodes: rows.all(NodeRow, `SELECT * FROM nodes WHERE flow_id=?`, id)
        .sort((a, b) => order.indexOf(a.node_key) - order.indexOf(b.node_key))
        .map((n) => {
          const nt = ntOf(n.type);
          // the node's capabilities (refine/chat/panel affordances) come from
          // its def — built-ins by registry key, declarative kinds by their
          // node_templates row (cached hydration)
          const def = nodeRegistry.maybe(n.type)
            ?? (nt?.is_builtin ? nodeRegistry.maybe(nt.key) : undefined)
            ?? declarativeDef(n.type, n.node_key);
          return {
            ...n,
            kind: nt?.kind ?? null,
            icon: nt?.icon ?? null,
            template_name: nt?.name ?? null,
            capabilities: uiCapabilities(def?.capabilities),
            cost: nodeCosts.get(n.id) ?? { totalCents: 0, tokens: 0, runs: [] },
            artifacts: rows.all(ArtifactRow,
              `SELECT id, node_id, flow_id, kind, version, content, meta, status, feedback, created_at
               FROM artifacts WHERE node_id=? ORDER BY kind, version`, n.id),
          };
        }),
    };
  }

  list() {
    // step children (plan fan-out) are hidden from the home flow list — they
    // are reachable from the parent's fan-out panel (§2 data model)
    const flows = db.all<Record<string, unknown>>(`
      SELECT f.*, t.key AS task_key, t.summary AS task_summary
      FROM flows f JOIN tasks t ON t.id=f.task_id
      WHERE (f.kind IS NULL OR f.kind <> 'step') AND f.parent_flow_id IS NULL
      ORDER BY f.updated_at DESC`);
    // Phase 4: per-parent step-progress summary for the home rows — ONE
    // grouped query over the linked checklist (children hidden, progress not)
    const fanoutByFlow = new Map<string, { steps: number; done: number }>();
    for (const r of db.all<{ flow_id: string; steps: number; done: number }>(`
      SELECT ps.flow_id,
        COUNT(*) AS steps,
        SUM(CASE WHEN ps.status='done' THEN 1 ELSE 0 END) AS done
      FROM plan_steps ps
      WHERE ps.sub_flow_id IS NOT NULL
      GROUP BY ps.flow_id`)) {
      fanoutByFlow.set(r.flow_id, { steps: r.steps, done: r.done });
    }
    if (fanoutByFlow.size) {
      for (const f of flows) {
        const fo = fanoutByFlow.get(f.id as string);
        if (fo) f.fanout = { ...fo, active: fo.done < fo.steps };
      }
    }
    return flows;
  }

  /** True when the flow is a step child (plan fan-out). Engine internal helper. */
  isStepChild(flowId: string): boolean {
    const row = db.get<{ parent_flow_id: string | null }>(
      `SELECT parent_flow_id FROM flows WHERE id=?`, flowId);
    return row?.parent_flow_id != null;
  }

  /**
   * Delete a whole flow: its step children (plan fan-out), every flow-owned
   * row, and the local worktree(s). Throws when the flow does not exist.
   */
  async delete(id: string): Promise<void> {
    const flow = db.get<{ id: string }>(`SELECT id FROM flows WHERE id=?`, id);
    if (!flow) throw new Error("flow not found");
    // "the whole flow" includes the step children — they are hidden from the
    // flow list and unreachable once the parent is gone. No deeper nesting
    // exists (step children never fan out again).
    const childIds = db
      .all<{ id: string }>(`SELECT id FROM flows WHERE parent_flow_id=?`, id)
      .map((r) => r.id);
    const ids = [id, ...childIds];
    // remove the local worktrees first (best-effort — the startup sweep also
    // cleans up any removal that fails or is interrupted here)
    await Promise.allSettled(
      ids.map((fid) =>
        worktreeManager.removeFlowWorktree(fid, { reason: "flow deleted" })),
    );
    for (const fid of ids) {
      for (const table of FLOW_CHILD_TABLES) {
        db.run(`DELETE FROM ${table} WHERE flow_id=?`, fid);
      }
    }
    db.run(`DELETE FROM flows WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids);
  }

  // ── context ──────────────────────────────────────────────────────────────

  ctx(flowId: string): FlowCtx {
    const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, flowId);
    if (!flow) throw new Error("flow not found");
    const task = rows.get(Task, `SELECT * FROM tasks WHERE id=?`, flow.task_id);
    if (!task) throw new Error("task not found");
    const repo = flow.repo_id ? db.repoById(flow.repo_id) ?? null : null;
    return { flow, task, repo };
  }

  private touch(flowId: string): void {
    db.run(`UPDATE flows SET updated_at=? WHERE id=?`, db.now(), flowId);
  }

  /** Engine internals shared with the SDLC builtin-chain module — not a public API. */
  setCurrentNode(flowId: string, key: string | null): void {
    db.run(`UPDATE flows SET current_node=?, updated_at=? WHERE id=?`, key, db.now(), flowId);
  }

  /** Engine internals shared with the SDLC builtin-chain module — not a public API. */
  setNodeStatus(flowId: string, nodeKey: string, status: string): void {
    db.run(`UPDATE nodes SET status=?, updated_at=? WHERE flow_id=? AND node_key=?`,
      status, db.now(), flowId, nodeKey);
  }

  // fire-and-forget wrapper: runs async, marks node failed on error.
  // Engine internals shared with the SDLC builtin-chain module — not a public API.
  bg(flowId: string, nodeKey: string | null, fn: () => Promise<void>): void {
    (async () => {
      try {
        await fn();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        // tag the event with the node it belongs to — the chat panel groups
        // flow-level rows per tab, and an untagged run failure would show up
        // on every node's feed
        db.emitEvent(flowId, null, "error", msg, { nodeKey });
        if (nodeKey) this.setNodeStatus(flowId, nodeKey, "failed");
        db.run(`UPDATE flows SET updated_at=? WHERE id=?`, db.now(), flowId);
      } finally {
        this.touch(flowId);
      }
    })();
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
    const def = this.defOf(flowId, nodeKey);
    const c = this.ctx(flowId);
    const ctx = deliveryPayload !== undefined ? this.ctxWithDelivery(c, deliveryPayload) : c;
    // the context map the input maps evaluate against — with the delivery
    // override when a webhook resumed the run
    const mapped = await this.evalInputMap(flowId, nodeKey, rawInput, buildFlowContext(ctx));
    const input = def.parseInput(mapped);
    const config = this.nodeConfigFor(flowId, nodeKey);
    const outcome = await def.run(ctx, input, config);
    return outcome.reply;
  }

  /** The flow ctx with a webhook delivery body as {{trigger.payload}} (fresh copy — no DB writes). */
  private ctxWithDelivery(c: FlowCtx, deliveryPayload: unknown): FlowCtx {
    return { ...c, flow: { ...c.flow, trigger_payload: deliveryPayload } } as FlowCtx;
  }

  /** The trigger input overlaid with the template node's evaluated input_map. */
  private async evalInputMap(flowId: string, nodeKey: string, rawInput: unknown, ctxMap?: FlowContextMap): Promise<unknown> {
    const g = this.graph(flowId);
    const spec = g?.byKey.get(nodeKey);
    const map = spec?.inputMap ?? {};
    const entries = Object.entries(map).filter(([, v]) => typeof v === "string" && (v as string).trim());
    if (!entries.length) return rawInput;
    const base: Record<string, unknown> =
      rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
        ? { ...(rawInput as Record<string, unknown>) }
        : {};
    const ctx = ctxMap ?? buildFlowContext(this.ctx(flowId));
    for (const [field, expr] of entries) {
      const r = await evalJsonata(expr as string, ctx);
      if (!r.ok) {
        throw new Error(`${nodeKey}: input_map.${field} ("${expr}") failed — ${r.error}`);
      }
      if (r.value !== undefined) base[field] = r.value;
    }
    return base;
  }

  /**
   * The inherited run input for a node that declares no input contract: the
   * upstream `next`-edge sources' outputs merged (last wins). `input_map` still
   * overlays explicit mappings at run time — the mapped field wins.
   */
  private inheritedInput(flowId: string, nodeKey: string, ctx: FlowCtx): Record<string, unknown> {
    const parents = (this.graph(flowId)?.edges ?? [])
      .filter((e) => e.kind === "next" && e.to === nodeKey)
      .map((e) => e.from);
    const nodesMap = buildFlowContext(ctx).nodes;
    const out: Record<string, unknown> = {};
    for (const p of parents) Object.assign(out, nodesMap[p]?.output ?? {});
    return out;
  }

  /** The def for a node instance: built-ins by registry key, declarative kinds hydrate from their node_templates row. */
  defOf(flowId: string, nodeKey: string) {
    return nodeRegistry.resolve(this.defKeyOf(flowId, nodeKey), nodeKey);
  }

  /** The ChainHost port the SDLC builtin-chain module drives (see
   *  nodes/chains/sdlc-chain.ts) — a deliberate narrow boundary, not a public API. */
  flowNodeConfig(flowId: string, nodeKey: string): Record<string, unknown> {
    return parseConfigSnapshot(db.get<{ config: string | null }>(
      `SELECT config FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey)?.config ?? null);
  }

  /** Full config layer stack for a node instance: class ← app ← flow snapshot.
   *  The ChainHost port the SDLC builtin-chain module drives (see
   *  nodes/chains/sdlc-chain.ts). */
  nodeConfigFor(flowId: string, nodeKey: string): Record<string, unknown> {
    const def = this.defOf(flowId, nodeKey);
    return mergeConfigLayers(def.defaultConfig(), appLayerConfig(def.key), this.flowNodeConfig(flowId, nodeKey));
  }

  // ── public triggers ──────────────────────────────────────────────────────

  startPlan(flowId: string, prompt?: string, decompose?: boolean, model?: string, promptIsBody?: boolean, complex?: boolean): void {
    const planKey = this.keyOfRole(flowId, NODE_KEYS.PLAN);
    if (!planKey) throw new Error("this flow template has no plan node");
    this.setCurrentNode(flowId, planKey);
    this.bg(flowId, planKey, () => this.runNode(flowId, planKey, {
      feedback: null, prompt: prompt ?? null, promptIsBody: promptIsBody ?? false,
      decompose: decompose ?? false, model: model ?? null, complex: complex ?? false,
    }).then(() => {}));
  }

  refinePlan(
    flowId: string,
    feedback: string,
    prompt?: string,
    model?: string,
    promptIsBody?: boolean,
    complex?: boolean,
    branchRef?: string,
    fresh?: boolean,
    contextBlocks?: string[],
  ): void {
    const planKey = this.keyOfRole(flowId, NODE_KEYS.PLAN);
    if (!planKey) throw new Error("this flow template has no plan node");
    this.setCurrentNode(flowId, planKey);
    this.bg(flowId, planKey, () => this.runNode(flowId, planKey, {
      feedback, prompt: prompt ?? null, promptIsBody: promptIsBody ?? false, decompose: false, model: model ?? null,
      complex: complex ?? false, branchRef: branchRef ?? null,
      fresh: fresh ?? null, contextBlocks: contextBlocks ?? [],
    }).then(() => {}));
  }

  // ── structured plan step editing ─────────────────────────────────────────
  private assertPlanEditable(flowId: string) {
    const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, flowId);
    if (flow?.current_node) throw new Error(`wait for the ${flow.current_node} run to finish before editing steps`);
    return this.latestResourceArtifact<{ id: string }>(flowId, NODE_KEYS.PLAN, "a.id");
  }

  /** Bulk-replace the checklist from the Plan view editor.
   *  Phase 3B softened fan-out guards: the editor sends each row's plan-step
   *  row id (PlanSteps payload), so a harmless title/detail/files edit keeps
   *  the row — and its pending child sub-flow's linkage — instead of being
   *  read as a remove + re-add (the old title-match-only guard errored loudly
   *  on renames and destroyed pending children). Rows that are actually
   *  removed still hit the guards: a pending child's flow closes silently, a
   *  started/merged child's step refuses loudly. */
  updatePlanSteps(flowId: string, input: PlanStepInput[]): void {
    if (!Array.isArray(input) || input.some((s) => !s?.title?.trim?.())) {
      throw new Error("steps must be an array of {title, detail?, files?}");
    }
    const latestPlan = this.assertPlanEditable(flowId);
    const guards = stepFlows.deletableStepIds(flowId);
    const existing = planSteps.list(flowId);
    const byId = new Map(existing.map((s) => [s.id, s]));
    const claimed = new Set<string>(); // existing rows matched to a kept input row
    const matched = new Map<number, string>(); // input index → existing row id
    for (const [i, row] of input.entries()) {
      const sentId = typeof row.id === "string" ? row.id.trim() : "";
      const m = sentId ? byId.get(sentId) : undefined;
      if (m && !claimed.has(m.id)) {
        claimed.add(m.id);
        matched.set(i, m.id);
      }
    }
    // rows the user removed: a started/merged child's step cannot go (loud);
    // rows matched above are by definition kept — never treated as removed
    const removedIds = existing
      .filter((s) => !claimed.has(s.id) && !guards.deletable.has(s.id));
    if (removedIds.length) {
      throw new Error(
        `plan step "${removedIds[0].title}" has an active or merged sub-flow and can't be removed — skip the step instead`);
    }
    for (const [stepId, childId] of guards.toCancel) {
      // a step the user REMOVED whose child never started — close the child so
      // no half-scheduled sub-flow lingers (kept rows cancel nothing)
      if (claimed.has(stepId)) continue;
      stepFlows.cancelUnstartedChild(childId);
    }
    const updated = planSteps.replace(
      flowId,
      latestPlan?.id ?? null,
      input.map((s) => ({ title: s.title.trim(), detail: s.detail, files: s.files, branch: s.branch })),
      { matchedRows: matched },
    );
    db.emitEvent(flowId, null, "lifecycle", `plan checklist edited (${updated.length} steps)`, {
      // route the event to the tab that owns the checklist (§3.3 — stamped at
      // emit time; the feed no longer guesses from message text)
      nodeKey: this.keyOfRole(flowId, NODE_KEYS.PLAN) ?? undefined,
    });
    this.touch(flowId);
  }

  /** Toggle one step done/pending. */
  setPlanStepStatus(flowId: string, stepId: string, status: "pending" | "done"): void {
    if (status !== "pending" && status !== "done") throw new Error("status must be pending|done");
    if (!planSteps.setStatus(flowId, stepId, status, "manual")) throw new Error("step not found");
    this.touch(flowId);
  }

  // ── template topology + edge-driven activation ───────────────────────────

  /** The flow's template graph (the seeded SDLC loop as the fallback). */
  private graph(flowId: string): TemplateGraph | null {
    return templateStore.graphForFlow(flowId);
  }

  /** Instance keys of the flow's template nodes with the given def key. */
  keysOfType(flowId: string, defKey: string): string[] {
    const g = this.graph(flowId);
    if (g) return g.nodes.filter((n) => n.defKey === defKey).map((n) => n.key);
    return rows.all(NodeRow, `SELECT * FROM nodes WHERE flow_id=?`, flowId)
      .filter((n) => n.type === defKey)
      .map((n) => n.node_key);
  }

  /** Instance keys → first instance of a def key. */
  firstKeyOfType(flowId: string, defKey: string): string | null {
    return this.keysOfType(flowId, defKey)[0] ?? null;
  }

  // ── chain-role routing (§T3/F1, F4): the engine names chain roles, never
  //    literal built-in def keys ─────────────────────────────────────────────

  /** The catalog def holding a chain role (plan/build/review/resolve), or undefined. */
  private roleDef(role: ChainRole) {
    return nodeRegistry.all().find((d) => d.chainRole === role);
  }

  /** The instance key of the flow's node holding a chain role — the
   *  metadata-routed lookup the SDLC chain module and panel entries consume. */
  keyOfRole(flowId: string, role: ChainRole): string | null {
    const def = this.roleDef(role);
    return def ? this.firstKeyOfType(flowId, def.key) : null;
  }

  /** Artifact kinds a chain role's def publishes as first-class engine
   *  resources (§T3/F3) — resource queries scope through this, not a literal kind. */
  private resourceKinds(role: ChainRole): readonly string[] {
    return this.roleDef(role)?.resourceArtifacts ?? [];
  }

  /**
   * The latest artifact version a chain role's def published as a first-class
   * resource (§T3/F3) — e.g. the plan document the plan editor and the
   * approval flow consume. Also on the StepFlowManager's engine surface
   * (publishedExecution reads the plan version through it).
   */
  latestResourceArtifact<T>(flowId: string, role: ChainRole, columns = "a.*"): T | undefined {
    const kinds = this.resourceKinds(role);
    if (!kinds.length) return undefined;
    return db.get<T>(
      `SELECT ${columns} FROM artifacts a JOIN nodes n ON n.id=a.node_id
       WHERE n.flow_id=? AND a.kind IN (${kinds.map(() => "?").join(",")})
       ORDER BY a.version DESC LIMIT 1`, flowId, ...kinds);
  }

  /**
   * Role lookups: the CI gate node (waits on the wait-source def's event
   * source — the pipeline kind declares `waitForKind`, §T3/F1), and the
   * post-gate chain [gate, …] from the template graph.
   * The ChainHost port the SDLC builtin-chain module drives (see
   * nodes/chains/sdlc-chain.ts) — a deliberate narrow boundary.
   */
  gateKey(flowId: string): string | null {
    const source = nodeRegistry.all().find((d) => d.waitForKind);
    if (!source?.waitForKind) return null;
    return templateStore.waitNodeKey(flowId, source.waitForKind) ?? this.firstKeyOfType(flowId, source.key);
  }

  /** def key of a node instance (for def resolution). */
  private defKeyOf(flowId: string, nodeKey: string): string {
    const g = this.graph(flowId);
    const spec = g?.byKey.get(nodeKey);
    if (spec) return spec.defKey;
    const n = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey);
    return n?.type ?? nodeKey;
  }

  /** Engine internals shared with the SDLC builtin-chain module — not a public API. */
  nodeStatus(flowId: string, nodeKey: string): string {
    return db.get<{ status: string }>(
      `SELECT status FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey)?.status ?? "";
  }

  /** True when a node instance is a source of terminal node status (done | approved). */
  private statusTerminalSuccess(s: string): boolean {
    return s === "done" || s === "approved";
  }

  /**
   * Edge activation (§3): a node just reached a success terminal (`done`, or
   * `approved` for approval-gated nodes, e.g. approvePlan) — resolve its
   * outgoing `next` edges and start whatever becomes eligible.
   *
   * Edge resolution per edge:
   *  - decision sources: an edge is active exactly when its `label` ∈
   *    `output.chosen` (labels are required on decision out-edges); every
   *    other out-edge resolves inactive
   *  - `condition` (JSONata over the flow context): absent or truthy ⇒ active
   *  - `kind: loop` edges are real re-entry edges: they activate only on an
   *    explicit truthy condition (no condition ⇒ display metadata, never
   *    activated), and entering a target resets it — and its downstream
   *    success-terminal path — to `pending` so the cycle can run again
   *
   * Inactive edges resolve their target side: a target whose incoming edges
   * are all resolved with none active becomes `skipped`, and the skip
   * propagates downstream (a skipped node's out-edges resolve inactive).
   *
   * Engine internals shared with the SDLC builtin-chain module — not a public API.
   */
  async advanceFrom(flowId: string, fromKey: string): Promise<void> {
    const g = this.graph(flowId);
    if (!g) return;
    const outgoing = g.edges.filter((e) => e.kind !== "loop" || e.condition?.trim())
      .filter((e) => e.from === fromKey);
    if (!outgoing.length) return;

    const fromSpec = g.byKey.get(fromKey);
    const fromNtKind = fromSpec ? this.nodeKind(g, fromSpec) : null;
    const chosen = fromNtKind === "decision" ? this.decisionChosen(flowId, fromKey) : null;
    const ctx = fromNtKind !== "decision" && outgoing.some((e) => e.condition?.trim())
      ? buildFlowContext(this.ctx(flowId)) : null;

    for (const e of outgoing) {
      const target = g.byKey.get(e.to);
      if (!target) continue;
      if (!(await this.edgeActive(flowId, e, { decision: fromNtKind === "decision", chosen, ctx }))) {
        await this.resolveInactiveTarget(flowId, g, e.to);
        continue;
      }
      if (!(await this.joinSatisfied(flowId, g, e.to))) continue;
      // loop-edge re-entry: the target (and its downstream success-terminal
      // path) resets to pending so the cycle runs again — see edgeActive's
      // loop rules
      if (e.kind === "loop") await this.resetLoopEntry(flowId, g, e.to);
      await this.startNodeStage(flowId, target.key);
    }
  }

  /**
   * Loop-edge entry: reset the target to `pending`, then every downstream
   * node along `next` edges that already holds a success terminal (done /
   * approved) — the re-entry rerun path (e.g. resolve → gate → review →
   * resolve). Nodes held elsewhere (pending/waiting/running/failed/
   * awaiting_approval/skipped) are never touched.
   */
  private async resetLoopEntry(flowId: string, g: TemplateGraph, key: string): Promise<void> {
    const queue = [key];
    const seen = new Set(queue);
    while (queue.length) {
      const k = queue.shift()!;
      const st = this.nodeStatus(flowId, k);
      if (this.statusTerminalSuccess(st)) {
        this.setNodeStatus(flowId, k, "pending");
        db.emitEvent(flowId, db.get<{ id: string }>(
          `SELECT id FROM nodes WHERE flow_id=? AND node_key=?`, flowId, k)?.id ?? null,
          "lifecycle", `${k} re-enters via the loop edge — reset to pending`);
        for (const e of g.edges.filter((e) => e.kind === "next" && e.from === k)) {
          if (!seen.has(e.to)) {
            seen.add(e.to);
            queue.push(e.to);
          }
        }
      }
    }
  }

  /** The node_templates kind behind a template node spec (decision/agent/…/builtin). */
  private nodeKind(g: TemplateGraph, spec: { nodeTemplateId: string; defKey: string }): string | null {
    return db.get<{ kind: string }>(`SELECT kind FROM node_templates WHERE id=?`, spec.nodeTemplateId)?.kind ?? null;
  }

  /** A decision node's chosen labels from its validated output ({} when absent). */
  private decisionChosen(flowId: string, nodeKey: string): string[] {
    const out = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey)?.output;
    const chosen = (out as { chosen?: unknown } | null)?.chosen;
    return Array.isArray(chosen) ? chosen.map((c) => String(c)) : [];
  }

  /**
   * One edge's active resolution. Decision sources gate on label ∈ chosen;
   * other edges evaluate their JSONata condition (absent ⇒ active). `loud`
   * emits an error event on a broken condition (the advance path); quiet
   * re-evaluations (join/skip checks) just resolve inactive.
   */
  private async edgeActive(
    flowId: string,
    e: TemplateEdgeSpec,
    src: { decision: boolean; chosen: string[] | null; ctx: unknown; loud?: boolean },
  ): Promise<boolean> {
    if (src.decision) {
      // a decision's out-edges carry labels; unlabeled edges never activate
      return e.label != null && (src.chosen ?? []).includes(e.label);
    }
    if (e.label != null) return false; // labels are only meaningful out of a decision
    if (e.kind === "loop") {
      // a loop edge is a re-entry edge: it activates only on an explicit truthy
      // condition — condition-less loop edges stay display metadata, and the
      // engine never picks an unconditional rerun (§4.3: no silent branches)
      if (!e.condition?.trim()) return false;
    }
    if (!e.condition?.trim()) return true;
    const r = await evalJsonata(e.condition, src.ctx ?? buildFlowContext(this.ctx(flowId)));
    if (!r.ok) {
      // a broken condition resolves the edge inactive and says so loudly —
      // the engine never silently picks a branch (§4.3)
      if (src.loud !== false) {
        db.emitEvent(flowId, null, "error",
          `edge ${e.from} → ${e.to}: the condition failed (${r.error}) — the branch resolves inactive`,
          { nodeKey: e.from });
      }
      return false;
    }
    return jsonataTruthy(r.value);
  }

  /**
   * The resolution state of a target's incoming `next` edges. An edge is
   * resolved when its source reached a terminal state (success or skipped);
   * it is active when the source succeeded AND the edge activates (decision ⇒
   * label ∈ chosen; condition ⇒ truthy; unlabeled plain edges ⇒ active).
   * Conditions re-evaluate quietly here — the flow context only carries node
   * outputs (stable once terminal), so re-evaluation is deterministic.
   */
  private async incomingResolution(flowId: string, g: TemplateGraph, key: string): Promise<{ total: number; resolved: number; active: number }> {
    const incoming = g.edges.filter((e) => e.kind === "next" && e.to === key);
    let resolved = 0;
    let active = 0;
    let flowCtx: unknown = null;
    let ctxBuilt = false;
    for (const e of incoming) {
      const src = g.byKey.get(e.from);
      if (!src) continue;
      const st = this.nodeStatus(flowId, e.from);
      const srcSkipped = st === "skipped";
      if (!this.statusTerminalSuccess(st) && !srcSkipped) continue;
      resolved++;
      if (srcSkipped) continue; // skipped sources propagate inactive
      const srcKind = this.nodeKind(g, src);
      if (srcKind !== "decision" && e.condition?.trim() && !ctxBuilt) {
        flowCtx = buildFlowContext(this.ctx(flowId));
        ctxBuilt = true;
      }
      const activeEdge = await this.edgeActive(flowId, e, {
        decision: srcKind === "decision",
        chosen: srcKind === "decision" ? this.decisionChosen(flowId, e.from) : null,
        ctx: flowCtx,
        loud: false,
      });
      if (activeEdge) active++;
    }
    return { total: incoming.length, resolved, active };
  }

  /**
   * An inactive edge resolved: when the target's incoming edges are now all
   * resolved with none active, the target becomes `skipped` and the skip
   * propagates to its own outgoing edges (§3: skipped propagation).
   */
  private async resolveInactiveTarget(flowId: string, g: TemplateGraph, key: string): Promise<void> {
    if (this.nodeStatus(flowId, key) !== "pending") return;
    const r = await this.incomingResolution(flowId, g, key);
    if (r.total === 0 || r.resolved !== r.total || r.active > 0) return;
    this.setNodeStatus(flowId, key, "skipped");
    db.emitEvent(flowId, db.get<{ id: string }>(
      `SELECT id FROM nodes WHERE flow_id=? AND node_key=?`, flowId, key)?.id ?? null,
      "lifecycle", `${key} skipped — no active branch leads to it`);
    // skipped sources propagate inactive downstream
    for (const e of g.edges.filter((e) => e.kind === "next" && e.from === key)) {
      await this.resolveInactiveTarget(flowId, g, e.to);
    }
  }

  /**
   * Join evaluation for a target's incoming `next` edges: all-resolved with at
   * least one active (skipped sources propagate inactive), or first-active
   * for `any` targets.
   */
  private async joinSatisfied(flowId: string, g: TemplateGraph, key: string): Promise<boolean> {
    const r = await this.incomingResolution(flowId, g, key);
    if (r.total === 0) return true;
    const spec = g.byKey.get(key);
    if (spec?.joinMode === "any") return r.active > 0;
    return r.resolved === r.total && r.active > 0;
  }

  /**
   * Run one trigger's node stage inline (sequential `triggerRuns` bundle —
   * e.g. the multi-branch build), then advance past it when it reached a
   * success terminal. Manual triggers are never started here; debounced
   * targets arm their event-source wait.
   *
   * Phase 4B: an auto/approval node whose `wait_for` is `webhook` or `timer`
   * does not run when it becomes eligible — it holds at `waiting` until the
   * event source delivers (a hook bound to this (flow, node) at flow creation
   * / a poller-driven timer), then `resumeNodeFromWebhook` /
   * `processWaitTimers` re-enter this stage with `resumeWaiting`. A debounced
   * node with `wait_for: comments` holds the same way — the comment debounce
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
  private async startNodeStage(
    flowId: string,
    nodeKey: string,
    opts: { rawInput?: unknown; rawPayload?: unknown; resumeWaiting?: boolean } = {},
  ): Promise<void> {
    const status = this.nodeStatus(flowId, nodeKey);
    if (opts.resumeWaiting ? status !== "waiting" : status !== "pending") return;
    const spec = this.graph(flowId)?.byKey.get(nodeKey);
    const tt = spec?.trigger.type ?? "auto";
    const wait = spec?.trigger.wait_for;
    if (tt === "manual") return;
    if (tt === "debounced") {
      // a debounced node holds at `waiting` until its event source's quiet
      // period elapses (the generic wait-timer machinery fires it); without a
      // source it never auto-starts (the SDLC scheduler drives it)
      if (!opts.resumeWaiting) {
        if (wait === "comments") {
          this.armNodeWait(flowId, nodeKey, wait, this.debounceMinutes(flowId, nodeKey, spec));
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
        this.armNodeWait(flowId, nodeKey, wait, spec?.trigger.minutes ?? null);
        return;
      }
    }
    this.setCurrentNode(flowId, nodeKey);
    try {
      const def = this.defOf(flowId, nodeKey);
      // ── fan-out check (plan fan-out, Phase 1): the only engine hook into the
      // run path. When the node's effective config carries a fan-out knob that
      // resolves to "steps" AND pending checklist steps exist, the
      // StepFlowManager expands into child flows and owns this node (the
      // aggregate + terminal transition happen on all-resolved, via
      // finishFanout). `whole-wrap` runs the def's normal whole path and wraps
      // the native output as a single-entry aggregate afterwards. Anything
      // else (unchanged default, whole) falls through byte-for-byte. Built-ins
      // and declarative nodes hit the same check — orchestration lives here,
      // node internals stay in their classes.
      const fanout = stepFlows.gate(flowId, nodeKey);
      if (fanout === "fanout") {
        await stepFlows.expand(flowId, nodeKey);
        return;
      }
      const runs =
        opts.rawInput !== undefined
          ? [{ input: opts.rawInput }]
          : // declarative nodes declare no input contract — the input IS the
            // previous node's output (merged when several edges feed in)
            def.inheritsParentInput
            ? [{ input: this.inheritedInput(flowId, nodeKey, this.ctx(flowId)) }]
            : def.triggerRuns(this.ctx(flowId));
      for (const run of runs) {
        run.before?.();
        await this.runNode(flowId, nodeKey, run.input, opts.rawPayload);
        run.after?.();
      }
      if (fanout === "whole-wrap") stepFlows.wrapWholeOutput(flowId, nodeKey);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      db.emitEvent(flowId, null, "error", msg, { nodeKey });
      this.setNodeStatus(flowId, nodeKey, "failed");
      if (this.isStepChild(flowId)) {
        // notify hook: this failed stage runs on a step child — its parent's
        // rollup/scheduling reacts (standard failed → retry/skip)
        stepFlows.onChildFinished(flowId);
      }
      return;
    } finally {
      this.clearCurrentIf(flowId, nodeKey);
    }
    const finalStatus = this.nodeStatus(flowId, nodeKey);
    if (this.isStepChild(flowId)) {
      // child-terminal notification hook (plan fan-out): the parent manager
      // reschedules the next sibling / publishes the aggregate
      stepFlows.onChildFinished(flowId);
    }
    if (this.statusTerminalSuccess(finalStatus)) {
      await this.advanceFrom(flowId, nodeKey);
    }
  }

  /**
   * A node that reached eligibility but still waits on an event source: mark
   * it `waiting` and arm the resume. `timer` and the comment debounce arm a
   * poller-driven deadline; the webhook case announces the hook endpoint the
   * sender POSTs to.
   */
  armNodeWait(flowId: string, nodeKey: string, wait: "webhook" | "timer" | "comments", minutes: number | null): void {
    if (this.nodeStatus(flowId, nodeKey) !== "pending") return;
    if (wait === "timer" || wait === "comments") {
      const mins = minutes ?? (wait === "comments" ? 10 : 1);
      this.waitTimers.set(`${flowId}\n${nodeKey}`, Date.now() + mins * 60_000);
    }
    // the inbound hook is provisioned at flow creation — ensure it exists so
    // the announcement and the sender's curl example always have an endpoint
    const hook = wait === "webhook" ? hookStore.ensureForNode(flowId, nodeKey) : undefined;
    this.setNodeStatus(flowId, nodeKey, "waiting");
    db.emitEvent(flowId, db.get<{ id: string }>(
      `SELECT id FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey)?.id ?? null,
      "lifecycle",
      wait === "timer"
        ? `${nodeKey} waits for a timer (${minutes ?? 1} min — the poller resumes it)`
        : wait === "comments"
        ? `${nodeKey} waits for the comment quiet period (${minutes ?? 10} min — new comments restart it; the poller fires it when the gate is clear)`
        : `${nodeKey} waits for a webhook delivery — POST to /api/hooks/${hook?.id ?? "(hook unbound)"}`);
  }

  /**
   * The declared quiet-period minutes for a debounced node: the template
   * trigger's `minutes`, falling back to the node's `quiet_minutes` config
   * knob (the flow's tuneable), then 10.
   */
  private debounceMinutes(flowId: string, nodeKey: string, spec?: { trigger: { minutes?: number } }): number {
    if (typeof spec?.trigger.minutes === "number" && spec.trigger.minutes >= 0) return spec.trigger.minutes;
    return configNumber(this.nodeConfigFor(flowId, nodeKey), "quiet_minutes", 10);
  }

  /**
   * Reset every armed comment-debounce wait of a flow — each new open comment
   * restarts the quiet period. The generic "reset-on-event while armed" timer
   * feature lives here (a property of the wait source, not of any node);
   * ingest paths (poller / git-host webhook) call it when open comments land.
   */
  bounceCommentWaits(flowId: string): void {
    const g = this.graph(flowId);
    if (!g) return;
    for (const spec of g.nodes) {
      if (spec.trigger.type !== "debounced" || spec.trigger.wait_for !== "comments") continue;
      if (this.nodeStatus(flowId, spec.key) !== "waiting") continue;
      this.waitTimers.set(`${flowId}\n${spec.key}`, Date.now() + this.debounceMinutes(flowId, spec.key, spec) * 60_000);
    }
  }

  approvePlan(flowId: string, executionOverride?: "whole" | "steps"): void {
    const planKey = this.keyOfRole(flowId, NODE_KEYS.PLAN);
    if (!planKey) throw new Error("this flow template has no plan node");
    // Phase 3B: the plan panel's override chip — the user forced whole/steps
    // at approve. Recorded in the plan version's plan-meta (execution +
    // executionSource: "override") so a downstream from-plan fan-out node
    // honors it; every plan-meta field rides the artifact, so the override is
    // auditable per version. When the forced value equals the published one,
    // the approve is a no-op for the meta.
    if (executionOverride === "whole" || executionOverride === "steps") {
      const plan = this.latestResourceArtifact<{ id: string; meta: string | null }>(flowId, NODE_KEYS.PLAN);
      if (!plan) throw new Error("no plan to approve");
      let meta: Record<string, unknown> = {};
      try {
        const m = plan.meta ? JSON.parse(plan.meta) : null;
        if (m && typeof m === "object") meta = m;
      } catch { meta = {}; }
      const was = meta.execution === "steps" ? "steps" : "whole";
      const wasSource = typeof meta.executionSource === "string" ? meta.executionSource : "unknown";
      if (was !== executionOverride) {
        meta.execution = executionOverride;
        meta.executionSource = "override";
        delete meta.execution_rationale; // the planner's rationale no longer applies
        db.run(`UPDATE artifacts SET meta=?, updated_at=? WHERE id=?`, JSON.stringify(meta), db.now(), plan.id);
        db.emitEvent(flowId, db.get<{ id: string }>(
          `SELECT id FROM nodes WHERE flow_id=? AND node_key=?`, flowId, planKey)?.id ?? null,
          "lifecycle",
          `plan execution overridden at approve: will execute ${executionOverride} (was ${was}, ${wasSource})`,
          { nodeKey: planKey });
      }
    }
    const plan = this.latestResourceArtifact<{ id: string; content: string; meta: string | null }>(flowId, NODE_KEYS.PLAN);
    if (!plan) throw new Error("no plan to approve");
    db.run(`UPDATE artifacts SET status='approved' WHERE id=?`, plan.id);
    this.setNodeStatus(flowId, planKey, "approved");

    // approvePlan originally inlined the plan→build handoff (plan-meta branch
    // decomposition, sequential builds). It now lives in the build node's
    // triggerRuns (a built-in internal) and is activated by the template edge
    // evaluation here. The run attribution picks the first downstream node the
    // engine will actually start (auto / approval trigger) — the SDLC build
    // today; custom edge targets in Phase 2 templates.
    const g = this.graph(flowId);
    const targets = g?.edges.filter((e) => e.kind === "next" && e.from === planKey) ?? [];
    const attribution = targets
      .map((e) => e.to)
      .find((k) => {
        const tt = g?.byKey.get(k)?.trigger.type ?? "auto";
        return tt === "auto" || tt === "approval";
      }) ?? planKey;
    this.setCurrentNode(flowId, attribution);
    this.bg(flowId, attribution, () => this.advanceFrom(flowId, planKey).then(() => {}));
  }

  approveBuild(flowId: string, branchName?: string): void {
    // step children route to the fan-out approve (merge-back, approve ≠ MR);
    // the parent's aggregate approval flows through the untouched chain below
    if (this.isStepChild(flowId)) {
      stepFlows.approveChildStep(flowId);
      return;
    }
    this.chain.approveBuild(flowId, branchName);
  }

  /** (Re)run the pipeline gate — from the Pipeline panel, poller, or webhook. */
  triggerPipelineGate(flowId: string, pipelineId?: number, prompt?: string, model?: string, promptIsBody?: boolean): void {
    this.chain.triggerPipelineGate(flowId, pipelineId, prompt, model, promptIsBody);
  }

  triggerResolve(flowId: string, prompt?: string, model?: string, promptIsBody?: boolean): void {
    this.chain.triggerResolve(flowId, prompt, model, promptIsBody);
  }

  triggerReview(flowId: string, prompt?: string, model?: string, promptIsBody?: boolean): void {
    this.chain.triggerReview(flowId, prompt, model, promptIsBody);
  }

  /**
   * The armed wait-timer deadline of the flow's debounced resolve node (epoch
   * ms), or null — the Resolve panel's scheduled start. The debounced resolve
   * is template data now (the review → resolve edge arms it), so this reads
   * the generic wait-timer state rather than a chain scheduler.
   */
  resolveScheduleAt(flowId: string): number | null {
    const key = this.debounceKey(flowId);
    return key ? this.waitTimers.get(`${flowId}\n${key}`) ?? null : null;
  }

  /** The armed resolve wait as wall-clock text ("14:32"), or null. */
  resolveScheduleClock(flowId: string): string | null {
    const at = this.resolveScheduleAt(flowId);
    if (at == null) return null;
    return new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  /** The resolve quiet period per flow (ms) — app layer + resolve `quiet_minutes` knob. */
  resolveDelayMs(flowId?: string): number {
    const resolveDef = this.roleDef(NODE_KEYS.RESOLVE);
    const base = resolveDef ? appLayerConfig(resolveDef.key) : {};
    if (!flowId || !resolveDef) {
      return configNumber(mergeConfigLayers(base), "quiet_minutes", 10) * 60_000;
    }
    const resolveKey = this.firstKeyOfType(flowId, resolveDef.key);
    const cfg = mergeConfigLayers(
      base,
      resolveKey ? this.flowNodeConfig(flowId, resolveKey) : {},
    );
    return configNumber(cfg, "quiet_minutes", 10) * 60_000;
  }

  /** The flow's debounced comment-wait node (the SDLC resolve role). */
  private debounceKey(flowId: string): string | null {
    return this.graph(flowId)?.nodes.find(
      (n) => n.trigger.type === "debounced" && n.trigger.wait_for === "comments",
    )?.key ?? null;
  }

  // true when the node already has an in-flight run — guards against the webhook
  // + poller + UI all triggering the same node concurrently.
  // Engine internals shared with the SDLC builtin-chain module — not a public API.
  nodeRunning(flowId: string, nodeKey: string): boolean {
    return db.get<{ status: string }>(`SELECT status FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey)?.status === "running";
  }
  /**
   * True while any stage of the post-MR chain (pipeline gate → review →
   * resolve) is running. The chain executes inline in one background task, so
   * between node statuses flipping there is always exactly one `running` stage
   * — this guard keeps the poller/webhook/UI from starting a second chain
   * alongside it.
   * Engine internals shared with the SDLC builtin-chain module — not a public API.
   */
  chainBusy(flowId: string): boolean {
    for (const key of templateStore.chainNodeKeys(flowId)) {
      if (this.nodeStatus(flowId, key) === "running") return true;
    }
    return false;
  }
  // ── Phase 2: generic (template-driven) node actions ──────────────────────
  // The five built-ins have their own refined entries above; these are the
  // counterparts declarative (agent, …) nodes drive from the runtime panel.

  /**
   * Start a pending node on demand (manual trigger / declarative node panel).
   * Success terminal states advance the template edges exactly like engine
   * auto-starts do; `awaiting_approval` finishes wait for the generic approve.
   */
  runNodeManual(flowId: string, nodeKey: string, opts: { prompt?: string; model?: string; input?: Record<string, unknown> } = {}): void {
    const node = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey);
    if (!node) throw new Error("unknown node");
    // a failed entry node re-runs from the form — its recorded input never
    // satisfied the contract, so the retry path (recorded input) can't help
    if (node.status !== "pending" && !(node.status === "failed" && this.defOf(flowId, nodeKey).isEntry)) {
      throw new Error(`run is not available while the node is ${node.status}`);
    }
    this.setCurrentNode(flowId, nodeKey);
    this.bg(flowId, nodeKey, async () => {
      try {
        // wait for upstream stages (join semantics mirror the engine's edge activation)
        const g = this.graph(flowId);
        if (g && !(await this.joinSatisfied(flowId, g, nodeKey))) {
          throw new Error("upstream nodes must finish before this run can start");
        }
        // `input` carries the values the user provided at trigger time (the
        // start node's contract form) — it IS the payload. prompt/model keep
        // today's shape for agent nodes when no explicit input is passed.
        const rawInput = opts.input && typeof opts.input === "object"
          ? { ...opts.input }
          : { prompt: opts.prompt ?? null, model: opts.model ?? null };
        await this.runNode(flowId, nodeKey, rawInput);
        const finalStatus = this.nodeStatus(flowId, nodeKey);
        if (this.isStepChild(flowId)) {
          stepFlows.onChildFinished(flowId);
        }
        if (this.statusTerminalSuccess(finalStatus)) {
          await this.advanceFrom(flowId, nodeKey);
        }
      } finally {
        if (this.nodeStatus(flowId, nodeKey) !== "running") this.clearCurrentIf(flowId, nodeKey);
      }
    });
  }

  /**
   * Approve an `awaiting_approval` node generically (approval-triggered
   * declarative nodes; e.g. an agent output held for review). Outgoing
   * template edges activate on approval — the same contract as plan/build.
   */
  approveNode(flowId: string, nodeKey: string): void {
    const node = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey);
    if (!node) throw new Error("unknown node");
    // step children route to the fan-out approve (merge-back vs plain approval)
    if (this.isStepChild(flowId) && node.status === "awaiting_approval") {
      stepFlows.approveChildStep(flowId);
      return;
    }
    if (node.status !== "awaiting_approval") {
      throw new Error(`${nodeKey} is not awaiting approval`);
    }
    const def = this.defOf(flowId, nodeKey);
    if (def.builtinApproval) throw new Error(`${nodeKey} approval belongs to its built-in flow actions`);
    db.emitEvent(flowId, node.id, "lifecycle", `${nodeKey} approved`);
    this.setNodeStatus(flowId, nodeKey, "approved");

    const g = this.graph(flowId);
    const targets = g?.edges.filter((e) => e.kind === "next" && e.from === nodeKey) ?? [];
    const attribution = targets
      .map((e) => e.to)
      .find((k) => {
        const tt = g?.byKey.get(k)?.trigger.type ?? "auto";
        return tt === "auto" || tt === "approval";
      }) ?? nodeKey;
    this.setCurrentNode(flowId, attribution);
    this.bg(flowId, attribution, async () => {
      try {
        await this.advanceFrom(flowId, nodeKey);
      } finally {
        this.clearCurrentIf(flowId, attribution);
      }
    });
  }

  /**
   * Record a branch pick on a decision node awaiting its choice (§4.3 manual
   * source / approval-override): validates the labels against the node's
   * choices, marks the node approved with `{chosen, rationale}` output, and
   * activates the chosen outgoing edges (everything else resolves inactive).
   */
  async chooseNode(flowId: string, nodeKey: string, chosen: string[], rationale?: string): Promise<void> {
    const node = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey);
    if (!node) throw new Error("unknown node");
    if (node.status !== "awaiting_approval") {
      throw new Error(`${nodeKey} is not waiting for a branch choice`);
    }
    const def = this.defOf(flowId, nodeKey);
    if (!("applyChoice" in def) || typeof (def as { applyChoice?: unknown }).applyChoice !== "function") {
      throw new Error(`${nodeKey} is not a decision node`);
    }
    if (!Array.isArray(chosen) || !chosen.length) throw new Error("pick at least one branch");
    await (def as { applyChoice: (n: NodeRow, f: string, c: string[], r?: string, ctx?: FlowCtx) => Promise<void> })
      .applyChoice(node, flowId, chosen.map((c) => String(c)), rationale?.trim() || undefined, this.ctx(flowId));

    // release downstream exactly like a generic approval does
    const g = this.graph(flowId);
    const targets = g?.edges.filter((e) => e.kind === "next" && e.from === nodeKey) ?? [];
    const attribution = targets
      .map((e) => e.to)
      .find((k) => {
        const tt = g?.byKey.get(k)?.trigger.type ?? "auto";
        return tt === "auto" || tt === "approval";
      }) ?? nodeKey;
    this.setCurrentNode(flowId, attribution);
    this.bg(flowId, attribution, async () => {
      try {
        await this.advanceFrom(flowId, nodeKey);
      } finally {
        this.clearCurrentIf(flowId, attribution);
      }
    });
  }

  /** Update a node instance's config layer (nodes.config), merging per key. */
  setNodeConfig(flowId: string, nodeKey: string, config: Record<string, unknown>): void {
    const node = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey);
    if (!node) throw new Error("unknown node");
    if (node.status === "running") throw new Error("can't reconfigure a node while it is running");
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error("config must be an object");
    }
    const merged = { ...(node.config ?? {}), ...config };
    nodeSupport.setNode(node.id, { config: JSON.stringify(merged) });
    db.emitEvent(flowId, node.id, "lifecycle", `${nodeKey} config updated`);
    this.touch(flowId);
  }

  /**
   * Skip one fan-out step (StepFlowManager internals): cancel the child, mark
   * the step done with `completed_by: 'skipped'`, emit, advance the scheduler.
   */
  skipFanoutStep(parentFlowId: string, stepId: string): void {
    stepFlows.skipStepFlow(parentFlowId, stepId);
  }

  /**
   * Approve one fan-out step from the parent's step card: routes into the
   * child flow's approve (merge-back for code children, plain close for
   * non-code ones). The MR still comes only from the parent's final approval.
   */
  approveFanoutStep(parentFlowId: string, stepId: string): void {
    const step = db.get<{ sub_flow_id: string | null }>(
      `SELECT sub_flow_id FROM plan_steps WHERE id=? AND flow_id=?`, stepId, parentFlowId);
    if (!step?.sub_flow_id) throw new Error("that step has no sub-flow yet");
    this.approveBuild(step.sub_flow_id); // step children route to the fan-out approve
  }

  /** Retry one failed fan-out step's child run (its recorded step input).
   *  A merge-back failure routes to the merge loop instead — the branch +
   *  approval state survive, so re-running the build prompt would discard the
   *  fix-agent work the conflict surfaced. */
  retryFanoutStep(parentFlowId: string, stepId: string): void {
    const step = db.get<{ sub_flow_id: string | null }>(
      `SELECT sub_flow_id FROM plan_steps WHERE id=? AND flow_id=?`, stepId, parentFlowId);
    if (!step?.sub_flow_id) throw new Error("that step has no sub-flow yet");
    if (stepFlows.resumeMergeRetry(parentFlowId, step.sub_flow_id)) return;
    const nodes = db.all<{ node_key: string; status: string }>(
      `SELECT node_key, status FROM nodes WHERE flow_id=?`, step.sub_flow_id);
    const n = nodes.find((x) => x.status === "failed");
    if (!n) throw new Error("the step child has no failed node to retry");
    this.retryNode(step.sub_flow_id, n.node_key);
  }

  /** Clear the current-node pointer when it still points at the given node.
   *  Engine internals shared with the SDLC builtin-chain module — not a public API. */
  clearCurrentIf(flowId: string, nodeKey: string): void {
    const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, flowId);
    if (flow?.current_node === nodeKey) this.setCurrentNode(flowId, null);
  }

  /** Re-run a node after failure, using its recorded (schema-validated) input. */
  retryNode(flowId: string, nodeKey: string): void {
    const node = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey);
    if (!node) throw new Error("unknown node");
    const def = this.defOf(flowId, nodeKey);
    if (!def.retryable) throw new Error(`cannot retry node ${nodeKey}`);

    // the recorded input is validated against the node's schema — retry fails
    // fast with a clear error rather than running with a corrupt payload
    const recorded = def.parseInput(node.input ?? {});
    if (node.status === "running") throw new Error(`${nodeKey} is already running`);
    if (node.status === "waiting") throw new Error(`${nodeKey} is waiting for its event source — retry after it resumes (or cancel it)`);
    if (templateStore.chainNodeKeys(flowId).includes(nodeKey) && this.chainBusy(flowId)) {
      throw new Error("wait for the current pipeline/review/resolve run to finish first");
    }
    db.emitEvent(flowId, node.id, "lifecycle", `retrying ${nodeKey}`);
    this.setCurrentNode(flowId, nodeKey);
    this.bg(flowId, nodeKey, async () => {
      // a retried node re-runs on its recorded input; the pipeline gate
      // self-heals (an already-green head finishes immediately) and a green
      // gate then advances the template edges (review → debounced resolve)
      await def.run(this.ctx(flowId), recorded, this.nodeConfigFor(flowId, nodeKey));
      // a retried generic node that now succeeded advances the template
      // edges exactly like the engine's auto-start path
      const finalStatus = this.nodeStatus(flowId, nodeKey);
      if (this.isStepChild(flowId)) {
        // child-terminal notification hook (plan fan-out): the parent's
        // scheduler/rollup reacts to the retried child's terminal state
        stepFlows.onChildFinished(flowId);
      }
      if (this.statusTerminalSuccess(finalStatus)) {
        await this.advanceFrom(flowId, nodeKey);
      }
    });
  }

  /**
   * Stop a node that is stuck in `running`. Kills the in-process run (local mode)
   * and marks the node failed so it can be retried.
   */
  async cancelNode(flowId: string, nodeKey: string): Promise<void> {
    const node = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey);
    if (!node) throw new Error("unknown node");
    const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, flowId);
    const active = db.all<{ cursor_run_id: string }>(
      `SELECT cursor_run_id FROM runs WHERE node_id=? AND status='running'`, node.id);
    if (flow?.execution_mode === "local") {
      for (const r of active) agentPortRegistry.forMode("local").cancel({ runId: r.cursor_run_id });
    }
    db.run(`UPDATE runs SET status='error', updated_at=? WHERE node_id=? AND status='running'`, db.now(), node.id);
    this.setNodeStatus(flowId, nodeKey, "failed");
    if (flow?.current_node === nodeKey) this.setCurrentNode(flowId, null);
    db.emitEvent(flowId, node.id, "lifecycle", `${nodeKey} stopped by user — retry when ready`);
    this.touch(flowId);
    if (this.isStepChild(flowId)) {
      // child-terminal notification hook (plan fan-out): a stopped step child
      // surfaces failed in its parent's rollup
      stepFlows.onChildFinished(flowId);
    }
  }

  /**
   * Chat with a node's agent — routed through the §T4 role interfaces
   * (`nodeRoles`): `chatOnly` asks a Converser for a lightweight conversational
   * reply (node state untouched); everything else goes to the node's ChatRefiner
   * when its capabilities opt in, and declines otherwise.
   */
  sendChat(flowId: string, nodeKey: string, content: string, chatOnly = false, model?: string): void {
    const def = this.defOf(flowId, nodeKey);
    db.addMessage(flowId, nodeKey, "user", content);
    this.setCurrentNode(flowId, nodeKey);
    this.bg(flowId, nodeKey, async () => {
      const reply = chatOnly
        ? (await nodeRoles.converserOf(def)?.converse(this.ctx(flowId), content)) ?? nodeRoles.noAgentReply(def.label)
        : (await nodeRoles.chatRefinerOf(def)?.chat(this.ctx(flowId), content, model)) ?? CHAT_DECLINED;
      db.addMessage(flowId, nodeKey, "assistant", reply || "Done.");
      this.setCurrentNode(flowId, null);
    });
  }

  // ── Phase 4: triggers — flow start, webhooks, schedule, wait timers ──────

  /**
   * Start a flow's automatic nodes (webhook/schedule-started flows, §6):
   * every node whose joins are already satisfied AND whose trigger type
   * auto-starts (auto runs; approval runs to its hold). Manual nodes wait for
   * the user; debounced nodes wait for their scheduler. The gitlab wait
   * sources (built-in gate chain) are driven by their own poller paths.
   */
  start(flowId: string): void {
    const g = this.graph(flowId);
    if (!g) throw new Error("this flow has no template graph");
    this.bg(flowId, null, async () => {
      for (const spec of g.nodes) {
        if (spec.trigger.type !== "auto" && spec.trigger.type !== "approval") continue;
        if (!(await this.joinSatisfied(flowId, g, spec.key))) continue;
        await this.startNodeStage(flowId, spec.key);
      }
    });
  }

  /**
   * Create and start a flow from a template's delivery — a webhook delivery
   * or a due schedule fire (manual task-picker starts go through create()).
   * The template declares the task TYPE its flows run on (`trigger.task_type`,
   * Phase 3) and binds the repo its flows attach to; the delivery's reserved
   * `repo` key can point at a different registered repo, and its
   * `execution_mode` / `harness` key can pin the exec mode. Auto-start
   * attaches the most recent imported task of the declared type — flows no
   * longer depend on one pinned task row existing. Execution mode defaults
   * to the repo: local when it has a local path, cloud otherwise.
   */
  startFromTemplate(templateId: string, payload: unknown, opts: { taskId?: string } = {}): string {
    const t = templateStore.flowTemplate(templateId);
    if (!t) throw new Error("template not found");
    // the store normalizes trigger.task_type on read (absent → first provider)
    const trigger = templateStore.graph(templateId)?.flowTrigger ?? {};
    const taskType = typeof trigger.task_type === "string" ? trigger.task_type : NO_TASK_TYPE;
    // Reserved delivery keys are consumed here before contract validation:
    // `repo` picks which registered repo this flow attaches to (the template
    // binding is the fallback), and the exec mode can be pinned per delivery.
    const body = payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>) : {};
    const deliveryRepo =
      typeof body[REPO_DELIVERY_KEY] === "string" ? body[REPO_DELIVERY_KEY].trim() : "";
    const rawMode =
      typeof body[EXEC_MODE_DELIVERY_KEY] === "string"
        ? (body[EXEC_MODE_DELIVERY_KEY] as string).trim().toLowerCase()
        : typeof body[EXEC_MODE_DELIVERY_ALIAS] === "string"
          ? (body[EXEC_MODE_DELIVERY_ALIAS] as string).trim().toLowerCase()
          : "";
    const deliveryMode = (EXEC_MODE_VALUES as readonly string[]).includes(rawMode)
      ? (rawMode as "local" | "cloud") : undefined;
    let repoId = typeof trigger.repo_id === "string" ? trigger.repo_id : "";
    if (deliveryRepo) {
      const deliveryRepoRow = db.repoById(deliveryRepo)
        ?? db.repoByCloudUrl(deliveryRepo)
        ?? db.listRepos().find((r) => r.name === deliveryRepo);
      if (!deliveryRepoRow) {
        throw new Error(
          `the delivery's "${REPO_DELIVERY_KEY}" doesn't match a registered repo — ` +
          `use the repo's id, URL or name`);
      }
      repoId = deliveryRepoRow.id;
    }
    if (!repoId) {
      throw new Error(
        `template "${t.name}" has no repo binding — schedule fires and webhook ` +
        `deliveries auto-create flows, so either bind a repo in the template ` +
        `editor's flow settings or pass "${REPO_DELIVERY_KEY}" in the payload`);
    }
    // The concrete task: a caller-provided taskId (manual/eager starts) wins
    // and is type-checked against the declared task_type; auto-start falls
    // back to the most recent imported task of that type.
    let taskId = typeof opts.taskId === "string" ? opts.taskId.trim() : "";
    if (taskId) {
      const existing = db.get<{ type: string }>(`SELECT type FROM tasks WHERE id=?`, taskId);
      if (!existing) throw new Error("the provided task no longer exists — import tasks first");
      if (existing.type !== taskType) {
        throw new Error(
          `task is a "${existing.type}" task but template "${t.name}" declares "${taskType}" task context — pick a ${taskType} task or change the template's task type`);
      }
    } else {
      const latest = db.get<{ id: string }>(
        `SELECT id FROM tasks WHERE type=? ORDER BY synced_at DESC, rowid DESC LIMIT 1`, taskType
      );
      if (!latest) {
        throw new Error(
          `template "${t.name}" runs on ${taskType} tasks but none are imported yet — import one on the task import screen first`);
      }
      taskId = latest.id;
    }
    const task = rows.get(Task, `SELECT * FROM tasks WHERE id=?`, taskId);
    if (!task) throw new Error("the template's task no longer exists — import tasks first");
    const repo = db.repoById(repoId);
    if (!repo) throw new Error("the template's bound repo no longer exists — rebind in the template editor");
    // the start node's contract defines what the trigger must provide (§5):
    // a payload that doesn't match is rejected here — no flow is created, and
    // the hook route answers the sender with this exact message. The reserved
    // delivery keys above were already consumed and never reach the contract.
    const startSpec = templateStore.graph(templateId)?.nodes.find((n) => n.defKey === nodeRegistry.entryKey());
    const contractFields = startSpec ? parseStartContract(startSpec.config) : [];
    if (contractFields.length) {
      const contractPayload: Record<string, unknown> = { ...body };
      delete contractPayload[REPO_DELIVERY_KEY];
      delete contractPayload[EXEC_MODE_DELIVERY_KEY];
      delete contractPayload[EXEC_MODE_DELIVERY_ALIAS];
      const v = validateAgainstContract(contractFields, contractPayload);
      if (!v.ok) {
        throw new Error(`payload doesn't match the "${t.name}" start contract — ${v.error}`);
      }
    }
    const id = this.create(taskId, repo.cloud_url, `${t.name} · ${new Date().toISOString()}`, {
      repoId,
      executionMode: deliveryMode ?? (repo.local_path ? "local" : "cloud"),
      templateId,
      triggerPayload: payload,
      // the delivery starts the flow itself — run its auto nodes straight up
      autoStart: true,
    });
    db.emitEvent(id, null, "lifecycle", `flow auto-created from the "${t.name}" template by a trigger — ${taskType} task ${task.key}`);
    return id;
  }

  /**
   * Resume a waiting node (wait_for webhook) with a delivery body (§6): the
   * delivery becomes the node's trigger input and `{{trigger.payload}}` for
   * this run's context (input maps + agent prompt variables). Non-waiting
   * deliveries (node already resumed/finished/never armed) error loudly.
   */
  resumeNodeFromWebhook(flowId: string, nodeKey: string, payload: unknown): void {
    const node = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey);
    if (!node) throw new Error("unknown node");
    const spec = this.graph(flowId)?.byKey.get(nodeKey);
    if (spec?.trigger.wait_for !== "webhook") throw new Error(`${nodeKey} is not waiting on a webhook`);
    if (node.status !== "waiting") throw new Error(`${nodeKey} is not waiting for an event`);
    db.emitEvent(flowId, node.id, "lifecycle", `${nodeKey} resumed by a webhook delivery`);
    this.bg(flowId, nodeKey, () =>
      this.startNodeStage(flowId, nodeKey, {
        resumeWaiting: true,
        rawInput: { payload, prompt: null, model: null },
        rawPayload: payload,
      }).then(() => {})
    );
  }

  /**
   * Per-(flow,node) in-memory timer state for `wait_for: timer` and the
   * debounced comment waits — armed when the node goes to `waiting`, fired
   * from the poller tick. In-memory like the resolve debounce; a restart
   * re-arms on the next join evaluation (the node is `waiting`, not `pending`,
   * so it resumes only via a new delivery).
   */
  private waitTimers = new Map<string, number>();

  /** Fire due wait-timer resumes (timer + debounced comment waits). Called from the poller tick. */
  processWaitTimers(): void {
    const now = Date.now();
    for (const [k, due] of [...this.waitTimers]) {
      if (now < due) continue;
      const i = k.indexOf("\n");
      const flowId = k.slice(0, i);
      const nodeKey = k.slice(i + 1);
      const spec = this.graph(flowId)?.byKey.get(nodeKey);
      if (spec?.trigger.type === "debounced" && spec.trigger.wait_for === "comments") {
        // debounced comment waits re-check their gates each tick instead of
        // firing into a moving chain: no open comments (nothing to resolve)
        // or a chain stage in flight → re-arm quietly, keep waiting
        const open = db.get<{ c: number }>(
          `SELECT COUNT(*) c FROM comments WHERE flow_id=? AND status='open'`, flowId)?.c ?? 0;
        if (open === 0 || this.chainBusy(flowId)) {
          this.waitTimers.set(k, now + this.debounceMinutes(flowId, nodeKey, spec) * 60_000);
          continue;
        }
      }
      this.waitTimers.delete(k);
      this.fireWaitTimer(flowId, nodeKey, spec?.trigger.type === "debounced" ? "quiet period elapsed" : undefined);
    }
  }

  private fireWaitTimer(flowId: string, nodeKey: string, note?: string): void {
    if (this.nodeStatus(flowId, nodeKey) !== "waiting") return;
    db.emitEvent(flowId, db.get<{ id: string }>(
      `SELECT id FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey)?.id ?? null,
      "lifecycle", note ? `${nodeKey} ${note} — resuming` : `${nodeKey} timer elapsed — resuming`);
    this.bg(flowId, nodeKey, () =>
      this.startNodeStage(flowId, nodeKey, { resumeWaiting: true }).then(() => {})
    );
  }

  // ── recovery (called by reconcile) ───────────────────────────────────────

  /**
   * Finish a running node from a run result obtained out-of-band (server restart
   * recovery / cloud re-attach). Delegates to the node's own recover().
   */
  async completeNodeFromResult(
    c: FlowCtx,
    node: NodeRow,
    result: AgentRunResult,
    note: string
  ): Promise<boolean> {
    db.run(`UPDATE runs SET status=?, updated_at=? WHERE node_id=? AND status='running'`,
      result.status === "finished" ? "finished" : "error", db.now(), node.id);
    if (node.status !== "running") return true; // already reconciled by a concurrent pass

    const def = this.defOf(c.flow.id, node.node_key);
    const ok = await def.recover(c, node, result, note);
    if (ok) return true;

    // node declined recovery → fail it so the user can retry
    nodeSupport.setNode(node.id, { status: "failed" });
    if (result.status !== "finished") {
      db.emitEvent(c.flow.id, node.id, "error", `${node.node_key} run ended with ${result.status} (${note}) — retry the node to continue`);
    } else {
      db.emitEvent(c.flow.id, node.id, "lifecycle", `${node.node_key} run finished while disconnected (${note}) — retry the node to apply it`);
    }
    return true;
  }

  // ── GitLab webhook / poll handling ───────────────────────────────────────

  /** project ids are only unique per git host — match host too when given. */
  findFlowByMR(projectId: number, mrIid: number, projectUrl?: string): FlowRow | undefined {
    // check branches table first (multi-branch MRs)
    const branchRow = rows.get(FlowRow,
      `SELECT f.* FROM branches b JOIN flows f ON f.id = b.flow_id
       WHERE b.mr_iid=? AND f.gitlab_project_id=?`, mrIid, projectId
    );
    if (branchRow) {
      if (projectUrl) {
        const h = hostOf(projectUrl);
        if (h && hostOf(branchRow.repo_url ?? "") !== h) {
          // host mismatch — fall through to flows table
        } else {
          return branchRow;
        }
      } else {
        return branchRow;
      }
    }
    // fall back to flows table (single-branch)
    const candidates = rows.all(FlowRow,
      `SELECT * FROM flows WHERE gitlab_project_id=? AND mr_iid=?`, projectId, mrIid
    );
    if (candidates.length <= 1) return candidates[0];
    const h = projectUrl ? hostOf(projectUrl) : null;
    if (!h) return candidates[0];
    return candidates.find((f) => hostOf(f.repo_url ?? "") === h) ?? candidates[0];
  }

  ingestComments(flowId: string, incoming: HostComment[]): number {
    let newOpen = 0;
    for (const c of incoming) {
      if (c.system) continue;
      const existing = db.get<{ id: string; status: string; resolved_by: string | null }>(
        `SELECT id,status,resolved_by FROM comments WHERE id=?`, c.id);
      const status = c.resolved ? "resolved" : "open";
      if (!existing) {
        db.run(
          `INSERT INTO comments (id,flow_id,mr_iid,discussion_id,author,body,file_path,line,status,raw,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          c.id, flowId, null, c.threadId, c.author, c.body,
          c.path ?? null, c.line ?? null,
          status, JSON.stringify(c), c.createdAt, db.now()
        );
        if (status === "open") newOpen++;
      } else if (existing.status !== status) {
        // Never resurrect a comment the agent already resolved: plain notes
        // (bot reports, summaries) aren't resolvable via the git-host API, so
        // the poll keeps reporting them as unresolved — without this guard
        // they'd flip back to open and trigger a redundant resolve run.
        if (existing.status === "resolved" && existing.resolved_by === "agent" && status === "open") continue;
        db.run(`UPDATE comments SET status=?, updated_at=? WHERE id=?`, status, db.now(), c.id);
        if (status === "open") newOpen++;
      }
    }
    return newOpen;
  }
}

export const flowEngine = processSingleton("flowEngine", () => new FlowEngine());

// plan fan-out: bind the StepFlowManager to the engine — resolves the
// flow ↔ step-flow-manager singleton cycle (step-flow-manager is imported by
// flow-engine.ts for the fan-out hook and cannot import the flowEngine value
// at module scope)
stepFlows.bind(flowEngine);
