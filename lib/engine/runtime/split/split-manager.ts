import "server-only";

import { z } from "zod";
import { db } from "../../../db";
import { FLOW_STATUS } from "../../../../constants/flow";
import {
  NODE_ACTIVE_STATUSES,
  NODE_IN_FLIGHT_STATUSES,
  NODE_SUCCESS_STATUSES,
  NODE_TERMINAL_STATUSES,
} from "../../constants/node-status";
import { processSingleton } from "../../../singleton";
import type { FlowCtx, NodeDefinition } from "../../nodes/shared";
import {
  SplitTargetError,
  UnitCycleError,
  assertSplitTargetCompatible,
  detectUnitCycle,
  resolveSplitTarget,
  splitConsumeOf,
  splitParallelMaxOf,
  type SplitConsumeMode,
  type SplitTarget,
  type SplitUnit,
} from "../../nodes/shared/split";
import { flowSplitTargetLookup } from "../../nodes/shared/split-lookup";
import { parseStartContract, type StartContractField } from "../../nodes/kinds/start/contract";
import { configString } from "../../templates/node-config";
import { templateStore } from "../../templates/template-store";

// ── the split runtime (agent-node split plan §3 — Phase 2) ───────────────────
// State authority for the `split_consume: "per-unit"` consumer knob: one real
// child flow per unit a source publishes, scheduled by declared `dependsOn` +
// a `parallel_max` slot budget (default 1 — no file-overlap inference, no
// plan-shaped assumptions), joined into an aggregate published on the
// consumer node in unit order (decision 4), with per-unit actions addressed
// by `unit.key` through the derived linkage.
//
// The manager is written against the narrow `SplitLinkIndex` seam
// (recommendation 1: linkage derived from `flows` — `parent_flow_id` + the
// child payload's `parentNodeKey`/`unit.key`); a future `split_units` table
// replaces the index class without touching the manager logic.
//
// Children are ordinary flows created through the narrower
// `flowEngine.createSplitChild` (the snapshot machinery of createStepChild,
// minus the step payload's start-contract validation — the manager validates
// each unit's item against its target's contract before any row exists).
// The graph a child runs is the graph the target denotes (recommendation 2):
// both target kinds resolve through the Phase-1 lookup and auto-wrap into a
// hidden single-node child template — a `node` target wraps the built-in
// catalog row (integration semantics: the child delivers into the parent), a
// `template` target wraps the declarative `node_templates` row, whose def
// hydrates exactly as it does in any template (delivery semantics).
//
// `FlowEngine` supplies the engine reference via `bind()` at module load
// (flow-engine.ts module tail), the same cycle resolution the
// StepFlowManager uses — this module cannot import the flowEngine value
// directly because flow-engine.ts imports the split manager for the
// child-terminal hooks.

// ── §2.7 domain constants ─────────────────────────────────────────────────────

/** Per-unit aggregate entry statuses (decision 4): the join publishes one
 *  entry per unit in unit order. `blocked` = the unit never started because
 *  a dependency failed/skipped/blocked — visible and retryable (retry the
 *  blocking unit); it never escalates the consumer's worst-of status by
 *  itself (the failed dependency it points at already did). */
export const SPLIT_UNIT_STATUSES = [
  "pending",
  "running",
  "awaiting_approval",
  "done",
  "failed",
  "skipped",
  "blocked",
] as const;
export type SplitUnitStatus = (typeof SPLIT_UNIT_STATUSES)[number];

/** The consumer's worst-of precedence (decision 4): failed > awaiting_approval > done. */
const WORST_OF_PRECEDENCE: readonly SplitUnitStatus[] = ["failed", "awaiting_approval", "done"];

/** The aggregate shape the join publishes on the consumer node — the split
 *  counterpart of the fan-out `steps` aggregate (unit order, per decision 4).
 *  A consumer def narrows it via its `splitOutput` capability. */
export const DEFAULT_SPLIT_OUTPUT = z.object({
  units: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      status: z.string(),
      output: z.unknown().optional(),
    })
  ),
});

/** The split child's trigger payload — persisted on the child flow row as
 *  `trigger_payload` (decision 1: linkage rides the flow). `parentNodeKey`
 *  names the consumer node on the parent that owns this child; `unit` is the
 *  serialized SplitUnit, rendered to the child as `{{input.unit.*}}`.
 *  `position` is the unit's index in the expansion that created the child —
 *  the aggregate's deterministic unit order (decision 4). */
export interface SplitChildPayload {
  parentNodeKey: string;
  unit: {
    key: string;
    title: string;
    dependsOn: string[];
    item: unknown;
    position: number;
  };
}

/** One derived unit ↔ child-flow association (the linkage row). */
export interface SplitChildLink {
  childFlowId: string;
  unitKey: string;
  unit: SplitChildPayload["unit"];
}

/**
 * The narrow linkage seam (decision 1): the manager's ONLY view of the
 * unit ↔ child-flow association. The default implementation derives it from
 * `flows` (`parent_flow_id` + `kind: 'split'` + the persisted child payload);
 * a future `split_units` table is a bounded swap behind this interface —
 * the manager logic never touches the flows table for linkage itself.
 */
export interface SplitLinkIndex {
  /** the (parent, consumer) node's links, in unit (expansion) order */
  linksOf(parentFlowId: string, consumerNodeKey: string): SplitChildLink[];
  /** one child flow's payload, or null when the flow carries no split linkage */
  childPayloadOf(childFlowId: string): SplitChildPayload | null;
  /** the consumer node that owns a unit key on this parent (the per-unit
   *  actions' optional addressing), or null when no split linkage carries it */
  consumerNodeOfUnit(parentFlowId: string, unitKey: string): string | null;
}

/** A required row: throws instead of a `!` assertion (AGENTS.md §3.4). */
function must<T>(row: T | undefined, what: string): T {
  if (row == null) throw new Error(`missing row: ${what}`);
  return row;
}

/** Defensive payload parse (unparseable / foreign payload → null). */
function parseSplitPayload(raw: string | null | undefined): SplitChildPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SplitChildPayload | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.parentNodeKey !== "string") return null;
    if (!parsed.unit || typeof parsed.unit !== "object" || typeof parsed.unit.key !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * The production linkage (decision 1): ONE query over the parent's child
 * flows; child payloads are parsed at exactly this point and nowhere else.
 */
export class FlowsSplitLinkIndex implements SplitLinkIndex {
  linksOf(parentFlowId: string, consumerNodeKey: string): SplitChildLink[] {
    const rows = db.all<{ id: string; trigger_payload: string | null }>(
      `SELECT id, trigger_payload FROM flows WHERE parent_flow_id=? AND kind='split' ORDER BY created_at, id`,
      parentFlowId
    );
    const links: SplitChildLink[] = [];
    for (const r of rows) {
      const payload = parseSplitPayload(r.trigger_payload);
      if (!payload || payload.parentNodeKey !== consumerNodeKey) continue;
      links.push({ childFlowId: r.id, unitKey: payload.unit.key, unit: payload.unit });
    }
    return links.sort((a, b) => a.unit.position - b.unit.position);
  }

  childPayloadOf(childFlowId: string): SplitChildPayload | null {
    const row = db.get<{ trigger_payload: string | null }>(
      `SELECT trigger_payload FROM flows WHERE id=?`, childFlowId
    );
    return parseSplitPayload(row?.trigger_payload);
  }

  consumerNodeOfUnit(parentFlowId: string, unitKey: string): string | null {
    const rows = db.all<{ trigger_payload: string | null }>(
      `SELECT trigger_payload FROM flows WHERE parent_flow_id=? AND kind='split' ORDER BY created_at, id`,
      parentFlowId
    );
    for (const r of rows) {
      const payload = parseSplitPayload(r.trigger_payload);
      if (payload?.unit.key === unitKey) return payload.parentNodeKey;
    }
    return null;
  }
}

/** Live state of one unit, derived from the linkage + the child flow — what
 *  the scheduler, the join and the actions all read. */
export interface SplitUnitState {
  key: string;
  title: string;
  dependsOn: string[];
  childFlowId: string | null;
  status: SplitUnitStatus;
  /** the child's merged node outputs ({} when the unit never produced output) */
  output: Record<string, unknown>;
}

/** The engine surface the manager drives — bound once by flow-engine.ts at
 *  module load (the same structural seam the StepFlowManager binds through). */
interface SplitEngineSurface {
  ctx(flowId: string): FlowCtx;
  defOf(flowId: string, nodeKey: string): NodeDefinition<unknown, Record<string, unknown>>;
  nodeConfigFor(flowId: string, nodeKey: string): Record<string, unknown>;
  createSplitChild(
    parentFlowId: string,
    templateId: string,
    name: string,
    payload: SplitChildPayload
  ): string;
  startStepChild(childFlowId: string): void;
  finishSplit(parentFlowId: string, nodeKey: string, output: Record<string, unknown>): Promise<void>;
  setNodeStatus(flowId: string, nodeKey: string, status: string): void;
  retryNode(flowId: string, nodeKey: string): void;
  cancelNode(flowId: string, nodeKey: string): Promise<void>;
  advanceFrom(flowId: string, nodeKey: string): Promise<void>;
}

/** Split knobs a node-target child's copied config strips (a child never
 *  splits — the nesting guard is the runtime rule, the strip is hygiene). */
const SPLIT_CONFIG_KEYS = ["split_consume", "split_parallel_max"] as const;

function stripSplitKeys(cfg: Record<string, unknown>): Record<string, unknown> {
  const out = { ...cfg };
  for (const k of SPLIT_CONFIG_KEYS) delete out[k];
  return out;
}

export class SplitManager {
  private engine: SplitEngineSurface | null = null;

  /** Called once from flow-engine.ts (module tail) — resolves the engine cycle. */
  bind(engine: SplitEngineSurface): void {
    this.engine = engine;
  }

  private get e(): SplitEngineSurface {
    if (!this.engine) throw new Error("SplitManager is not bound to the engine yet");
    return this.engine;
  }

  constructor(private readonly linkage: SplitLinkIndex = new FlowsSplitLinkIndex()) {}

  // ── expansion (§3) ──────────────────────────────────────────────────────────

  /**
   * Expand a per-unit consumer into one child flow per unit of the source's
   * published units. Re-runs reconcile on `unit.key` stability: new units get
   * children, unchanged units keep theirs — never recreated. Returns true
   * when the consumer owns split linkage after the call (engaged), false
   * when the manager is not engaged (consumer not `per-unit`, nested flow,
   * source published no units). Producer errors (cycles, unknown/duplicate
   * targets, contract mismatches) throw loudly BEFORE any child row exists —
   * the engine's trigger path fails the consumer node on the throw, exactly
   * like a contract failure.
   */
  expand(
    parentFlowId: string,
    consumerNodeKey: string,
    sourceNodeKey: string,
    // the engine's split gate passes the RESOLVED mode: a `source` consumer
    // deferring to a per-unit recommendation has raw config `split_consume:
    // "source"` here (Phase 4); direct callers omit it and the config decides
    opts: { consume?: SplitConsumeMode } = {},
  ): boolean {
    const flow = db.get<{ parent_flow_id: string | null }>(
      `SELECT parent_flow_id FROM flows WHERE id=?`, parentFlowId
    );
    if (!flow) throw new Error(`parent flow ${parentFlowId} not found`);
    // nesting guard (§3): children never split — a `per-unit` consumer inside
    // a child flow resolves to `whole`, enforced here, not by convention
    if (flow.parent_flow_id != null) return false;
    const consume = opts.consume ?? splitConsumeOf(this.e.nodeConfigFor(parentFlowId, consumerNodeKey));
    if (consume !== "per-unit") return false;
    const ctx = this.e.ctx(parentFlowId);
    const units = this.e.defOf(parentFlowId, sourceNodeKey).splitUnits(ctx);
    if (!units || !units.length) return false;

    // loud producer errors before any child row exists (§3 policy)
    const cycle = detectUnitCycle(units);
    if (cycle) throw new UnitCycleError(cycle);
    const dupes = units.filter((u, i) => units.findIndex((x) => x.key === u.key) !== i);
    if (dupes.length) {
      throw new SplitTargetError(`duplicate unit keys from the source: ${[...new Set(dupes.map((u) => u.key))].join(", ")}`);
    }
    // the split config default target comes from the source def's config
    // (`split_target` — Phase 3's AgentDef.split.target feeds the same knob)
    const defaultTarget = configString(this.e.nodeConfigFor(parentFlowId, sourceNodeKey), "split_target");
    const resolved = units.map((unit, position) => {
      const target = resolveSplitTarget(unit.target ?? defaultTarget ?? "", flowSplitTargetLookup);
      assertSplitTargetCompatible(target, unit.item, this.templateContractFields(target));
      return { unit, position, target };
    });

    const existing = new Map(this.linkage.linksOf(parentFlowId, consumerNodeKey).map((l) => [l.unitKey, l.childFlowId]));
    let made = 0;
    for (const r of resolved) {
      if (existing.has(r.unit.key)) continue; // unchanged unit keeps its child (§2.1)
      this.createChildFor(parentFlowId, consumerNodeKey, r.unit, r.position, r.target);
      made++;
    }
    if (!made && !existing.size) return false;
    if (made) {
      this.e.setNodeStatus(parentFlowId, consumerNodeKey, "running");
      db.emitEvent(parentFlowId, null, "lifecycle",
        `${consumerNodeKey} splits into ${made} unit child flow${made > 1 ? "s" : ""} — one child per published unit`,
        { nodeKey: consumerNodeKey });
    }
    this.advance(parentFlowId, consumerNodeKey);
    return true;
  }

  /** The target's start contract fields (the unit-item compatibility check
   *  rides the same contract parsing the fan-out manager uses). A `template`
   *  target's contract is the declarative row's `contract` config block
   *  (absent = accepts anything); a `node` target declares its split-capable
   *  input via the `split_consume` knob instead (Phase 4). */
  private templateContractFields(target: SplitTarget): StartContractField[] {
    if (target.kind === "node") return [];
    const row = templateStore.nodeTemplate(target.id);
    if (!row) throw new SplitTargetError(`split target template "${target.id}" does not exist`);
    return parseStartContract(row.config);
  }

  /** Create one child flow for a unit (the target decides the graph shape —
   *  recommendation 2) and persist the linkage in its payload (decision 1). */
  private createChildFor(
    parentFlowId: string,
    consumerNodeKey: string,
    unit: SplitUnit,
    position: number,
    target: SplitTarget
  ): string {
    const templateId = this.unitChildTemplateId(parentFlowId, target);
    const payload: SplitChildPayload = {
      parentNodeKey: consumerNodeKey,
      unit: { key: unit.key, title: unit.title, dependsOn: [...unit.dependsOn], item: unit.item, position },
    };
    const name = db.get<{ name: string }>(`SELECT name FROM flows WHERE id=?`, parentFlowId)?.name ?? parentFlowId;
    const childId = this.e.createSplitChild(parentFlowId, templateId, `${name} · unit: ${unit.title}`, payload);
    db.emitEvent(parentFlowId, null, "lifecycle",
      `split: unit "${unit.title}" → child flow`,
      { nodeKey: consumerNodeKey, childFlowId: childId, unitKey: unit.key });
    return childId;
  }

  /**
   * Any target's child graph: find-or-create the hidden `"{name} · unit"`
   * single-node child template (the auto-wrap pattern — the unit's node runs
   * in its own flow at flow granularity). A `node` target wraps the built-in
   * catalog row (the instance key must be the catalog key; config copies the
   * target's instance snapshot from the parent's graph, minus the split
   * knobs); a `template` target wraps the declarative `node_templates` row —
   * the def hydrates from the row exactly as it does in any template.
   */
  private unitChildTemplateId(parentFlowId: string, target: SplitTarget): string {
    const row = target.kind === "template"
      ? must(templateStore.nodeTemplate(target.id), `split target template row ${target.id}`)
      : must(templateStore.nodeTemplateByKey(target.key), `split node target "${target.key}" catalog row`);
    if (target.kind === "node" && !row.is_builtin) {
      throw new SplitTargetError(`split node target "${target.key}" is not a builtin node key`);
    }
    const instanceKey = target.kind === "template" ? row.key : target.key;
    const spec = target.kind === "node"
      ? templateStore.graphForFlow(parentFlowId)?.byKey.get(target.key)
      : undefined;
    const name = `${row.name} · unit`;
    const existing = templateStore.list({ includeHidden: true })
      .find((t) => t.hidden === 1 && t.name === name);
    if (existing) return existing.id;
    const tplId = templateStore.create({
      name,
      description: `Auto-wrapped unit child of "${row.name}" (split runtime) — one node instance; the unit arrives in the trigger payload.`,
      trigger: { type: "manual" },
      nodes: [
        {
          key: instanceKey,
          nodeTemplateId: row.id,
          trigger: { type: "auto" },
          config: stripSplitKeys(spec?.config ?? {}),
          input_map: spec?.inputMap ?? {},
        },
      ],
      edges: [],
    }, { skipLint: true });
    db.run(`UPDATE flow_templates SET hidden=1, updated_at=? WHERE id=?`, db.now(), tplId);
    return tplId;
  }

  // ── scheduling (§3: deps + slot — the ONLY inputs) ──────────────────────────

  /**
   * Start eligible units — all `dependsOn` keys resolved `done` + a free
   * slot — up to `parallel_max` (the consumer's `split_parallel_max` knob,
   * default 1). No file-overlap inference: a failed unit fails its
   * dependents (they surface `blocked`); non-dependents proceed. Then runs
   * the join check (a start can complete the unit set).
   */
  advance(parentFlowId: string, consumerNodeKey: string): void {
    const states = this.unitStates(parentFlowId, consumerNodeKey);
    if (!states.length) return;
    const parallelMax = splitParallelMaxOf(
      this.e.nodeConfigFor(parentFlowId, consumerNodeKey));
    // claims prevent double-starts when two hooks hit advance concurrently
    // (a child terminal + a user action can interleave): a start that never
    // took re-arms the slot after 60 s; the claim is dropped as soon as the
    // unit leaves `pending` (running / awaiting / terminal)
    const now = Date.now();
    for (const [id, at] of this.claimedStarts) {
      if (now - at > 60_000) this.claimedStarts.delete(id);
    }
    for (const s of states) if (s.childFlowId && s.status !== "pending") this.claimedStarts.delete(s.childFlowId);
    // a unit occupies a slot while running or awaiting approval (approval is
    // mid-work — the same slot semantics the step fan-out scheduler uses)
    const inFlight = states.filter((s) => s.status === "running" || s.status === "awaiting_approval").length;
    let slots = parallelMax - inFlight;
    if (slots > 0) {
      for (const s of states) {
        if (slots <= 0) break;
        if (!s.childFlowId || s.status !== "pending") continue;
        if (this.claimedStarts.has(s.childFlowId)) continue;
        if (!s.dependsOn.every((d) => states.find((x) => x.key === d)?.status === "done")) continue;
        this.claimedStarts.set(s.childFlowId, now);
        this.e.startStepChild(s.childFlowId); // fire-and-forget (engine bg) — keep filling free slots
        slots--;
      }
    }
    void this.checkJoin(parentFlowId, consumerNodeKey);
  }

  /** In-process start claims (see advance) — the split scheduler's guard
   *  against starting one unit's child twice while a previous start's bg run
   *  is still pending. */
  private claimedStarts = new Map<string, number>();

  // ── state derivation ────────────────────────────────────────────────────────

  /**
   * All unit states a consumer node owns, in unit (expansion) order — the
   * scheduler's, the join's and the actions' single view. Includes the
   * `blocked` closure: a pending unit whose dependency failed/skipped/blocked
   * (or is unknown — it could never resolve) can never start.
   */
  statesOf(parentFlowId: string, consumerNodeKey: string): SplitUnitState[] {
    return this.unitStates(parentFlowId, consumerNodeKey);
  }

  /**
   * The consumer node key that owns a unit key on this flow (the per-unit
   * actions' optional addressing — the caller may address a unit by key
   * alone), or null when no split linkage on the flow carries it.
   */
  consumerOfUnit(parentFlowId: string, unitKey: string): string | null {
    return this.linkage.consumerNodeOfUnit(parentFlowId, unitKey);
  }

  private unitStates(parentFlowId: string, consumerNodeKey: string): SplitUnitState[] {
    const links = this.linkage.linksOf(parentFlowId, consumerNodeKey);
    const states: SplitUnitState[] = links.map((link) => {
      const flowStatus = db.get<{ status: string }>(`SELECT status FROM flows WHERE id=?`, link.childFlowId)?.status ?? null;
      const statuses = db.all<{ status: string }>(
        `SELECT status FROM nodes WHERE flow_id=? ORDER BY created_at`, link.childFlowId
      ).map((n) => n.status);
      const status = SplitManager.unitStatusOf(statuses, flowStatus);
      return {
        key: link.unitKey,
        title: link.unit.title,
        dependsOn: link.unit.dependsOn,
        childFlowId: link.childFlowId,
        status,
        output: this.childOutput(link.childFlowId),
      };
    });
    // the blocked closure: computed off the derived statuses (a pending unit
    // behind a failed/skipped/blocked dependency is blocked too — transitively)
    const byKey = new Map(states.map((s) => [s.key, s]));
    const resolved = new Map<string, SplitUnitStatus>();
    const statusWithBlocked = (key: string, seen: Set<string>): SplitUnitStatus => {
      const memo = resolved.get(key);
      if (memo) return memo;
      const s = byKey.get(key);
      if (!s) return "blocked"; // a dependency on an unknown key never resolves
      if (s.status !== "pending") return s.status;
      if (seen.has(key)) return s.status; // defensive — cycles fail at expansion
      seen.add(key);
      const blocked = s.dependsOn.some((d) => {
        const ds = statusWithBlocked(d, seen);
        return ds === "failed" || ds === "skipped" || ds === "blocked";
      });
      const out = blocked ? "blocked" : s.status;
      resolved.set(key, out);
      return out;
    };
    for (const s of states) statusWithBlocked(s.key, new Set());
    return states.map((s) => {
      const status = resolved.get(s.key) ?? s.status;
      return { ...s, status };
    });
  }

  /** Roll a child's node set to one unit status: skipped (flow-level marker) >
   *  failed > awaiting_approval > running > done > pending. */
  private static unitStatusOf(statuses: string[], flowStatus: string | null): SplitUnitStatus {
    if (flowStatus === FLOW_STATUS.SKIPPED) return "skipped";
    if (statuses.some((s) => s === FLOW_STATUS.FAILED)) return "failed";
    if (statuses.some((s) => s === FLOW_STATUS.AWAITING_APPROVAL)) return "awaiting_approval";
    if (statuses.some((s) => s === FLOW_STATUS.RUNNING)) return "running";
    if (statuses.length && statuses.every((s) => NODE_SUCCESS_STATUSES.includes(s))) {
      return "done";
    }
    if (flowStatus === FLOW_STATUS.DONE) return "done";
    return "pending";
  }

  /** A child's merged node outputs (last write wins per key; {} when none). */
  private childOutput(childFlowId: string): Record<string, unknown> {
    const outs = db.all<{ output: string | null }>(
      `SELECT output FROM nodes WHERE flow_id=? AND output IS NOT NULL ORDER BY updated_at`, childFlowId);
    const merged: Record<string, unknown> = {};
    for (const row of outs) {
      if (!row.output) continue;
      try {
        const parsed = JSON.parse(row.output);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          Object.assign(merged, parsed);
        }
      } catch { /* unparseable output column — skipped */ }
    }
    return merged;
  }

  // ── join (§3, decision 4) ───────────────────────────────────────────────────

  /**
   * The join check: when no unit can advance — none running, none unstarted
   * with all dependencies done — publish the aggregate on the consumer node
   * (one entry per unit in unit order, failed units as failed entries, their
   * never-started dependents as `blocked`) and release the parent through the
   * engine's split terminal. Idempotent: later hooks re-publish the same
   * aggregate until every entry is terminal (a retried unit flips its entry).
   */
  private async checkJoin(parentFlowId: string, consumerNodeKey: string): Promise<void> {
    const states = this.unitStates(parentFlowId, consumerNodeKey);
    if (!states.length) return;
    if (states.some((s) => s.status === "running")) return;
    // an unstarted unit whose dependencies are all done could still advance —
    // but only when a slot is actually free (an awaiting-approval unit holds
    // its slot until the user acts; nothing can advance around it — the join
    // publishes then, the awaiting entry surfacing in the worst-of status)
    const parallelMax = splitParallelMaxOf(
      this.e.nodeConfigFor(parentFlowId, consumerNodeKey));
    const inFlight = states.filter((s) => s.status === "running" || s.status === "awaiting_approval").length;
    const couldAdvance = inFlight < parallelMax && states.some((s) =>
      s.status === "pending" && s.dependsOn.every((d) => states.find((x) => x.key === d)?.status === "done"));
    if (couldAdvance) return;
    const entries = states.map((s) => ({ key: s.key, title: s.title, status: s.status, output: s.output }));
    const worst = WORST_OF_PRECEDENCE.find((w) => entries.some((e) => e.status === w)) ?? "done";
    await this.e.finishSplit(parentFlowId, consumerNodeKey, { units: entries, worst });
  }

  // ── child terminal hook (the engine's additive tail calls) ─────────────────

  /**
   * Notification hook — called from the engine's node-stage / retry / cancel
   * tails when a child flow reached a terminal state. No-op unless the flow
   * is a split child (linkage check first — the whole method is two queries
   * for non-split children), then reschedules the parent's units.
   */
  onChildFinished(childFlowId: string): void {
    const payload = this.linkage.childPayloadOf(childFlowId);
    if (!payload?.parentNodeKey || !payload.unit?.key) return; // no split linkage
    const flow = db.get<{ parent_flow_id: string | null; kind: string | null; status: string }>(
      `SELECT parent_flow_id, kind, status FROM flows WHERE id=?`, childFlowId
    );
    if (!flow?.parent_flow_id || flow.kind !== "split") return;
    // a multi-node (template-target) child mid-graph is not terminal yet —
    // intermediate node finishes don't reschedule the parent's units. An
    // `awaiting_approval` node DOES: the unit holds a scheduler slot until
    // the user acts, and the join accounts for it.
    const statuses = db.all<{ status: string }>(`SELECT status FROM nodes WHERE flow_id=?`, childFlowId)
      .map((n) => n.status);
    const flowClosed = flow.status === FLOW_STATUS.DONE || flow.status === FLOW_STATUS.SKIPPED;
    const allTerminal = statuses.length > 0
      && statuses.every((s) => NODE_TERMINAL_STATUSES.includes(s));
    const holding = statuses.some((s) => s === FLOW_STATUS.AWAITING_APPROVAL);
    if (!allTerminal && !holding && !flowClosed) return;
    db.emitEvent(flow.parent_flow_id, null, "lifecycle",
      `split unit "${payload.unit.title}" resolved`,
      { nodeKey: payload.parentNodeKey, childFlowId, unitKey: payload.unit.key });
    this.advance(flow.parent_flow_id, payload.parentNodeKey);
  }

  // ── per-unit actions (§3), addressed by unit.key through the linkage ────────

  /**
   * Skip a unit: stop any in-flight run, mark the unit's nodes skipped, close
   * the child flow with the `skipped` marker (the aggregate surfaces
   * `skipped`), and reschedule — the unit's dependents become `blocked`.
   */
  async skipUnit(parentFlowId: string, consumerNodeKey: string, unitKey: string): Promise<void> {
    const state = this.stateFor(parentFlowId, consumerNodeKey, unitKey);
    if (!state.childFlowId) throw new Error(`unit "${unitKey}" has no child flow to skip`);
    if (state.status === "done" || state.status === "skipped") {
      throw new Error(`unit "${unitKey}" is already ${state.status}`);
    }
    await this.stopActiveChildNodes(state.childFlowId);
    db.run(`UPDATE nodes SET status='skipped', updated_at=? WHERE flow_id=? AND status NOT IN ('done','skipped')`,
      db.now(), state.childFlowId);
    db.run(`UPDATE flows SET status='skipped', updated_at=? WHERE id=?`, db.now(), state.childFlowId);
    db.emitEvent(parentFlowId, null, "lifecycle",
      `split unit "${state.title}" skipped`, { nodeKey: consumerNodeKey, unitKey, childFlowId: state.childFlowId });
    this.advance(parentFlowId, consumerNodeKey);
  }

  /** Retry a failed unit's child run (its recorded input). Blocked units have
   *  no failed run of their own — retry the failed dependency that blocks them. */
  retryUnit(parentFlowId: string, consumerNodeKey: string, unitKey: string): void {
    const state = this.stateFor(parentFlowId, consumerNodeKey, unitKey);
    if (!state.childFlowId) throw new Error(`unit "${unitKey}" has no child flow to retry`);
    const failed = db.all<{ node_key: string }>(
      `SELECT node_key FROM nodes WHERE flow_id=? AND status='failed'`, state.childFlowId);
    if (!failed.length) throw new Error(`unit "${unitKey}" has no failed node to retry`);
    this.e.retryNode(state.childFlowId, failed[0].node_key); // hooks reschedule on finish
  }

  /**
   * Approve a unit holding at `awaiting_approval`. Implemented inline (not
   * through the generic approveNode): that route sends every child flow to
   * the plan fan-out approve, which split children have no plan step for.
   */
  approveUnit(parentFlowId: string, consumerNodeKey: string, unitKey: string): void {
    const state = this.stateFor(parentFlowId, consumerNodeKey, unitKey);
    if (!state.childFlowId) throw new Error(`unit "${unitKey}" has no child flow to approve`);
    const awaiting = db.all<{ node_key: string }>(
      `SELECT node_key FROM nodes WHERE flow_id=? AND status='awaiting_approval'`, state.childFlowId);
    if (!awaiting.length) throw new Error(`unit "${unitKey}" is not awaiting approval`);
    for (const n of awaiting) {
      this.e.setNodeStatus(state.childFlowId, n.node_key, FLOW_STATUS.APPROVED);
      db.emitEvent(state.childFlowId, null, "lifecycle", `${n.node_key} approved`);
    }
    // the child's own graph continues past its approval gate, if it has one
    void this.e.advanceFrom(state.childFlowId, awaiting[0].node_key);
    this.advance(parentFlowId, consumerNodeKey);
  }

  /** Cancel a unit: stop its active runs (standard stop), leaving the unit
   *  failed — its dependents surface `blocked`, the aggregate republishes. */
  async cancelUnit(parentFlowId: string, consumerNodeKey: string, unitKey: string): Promise<void> {
    const state = this.stateFor(parentFlowId, consumerNodeKey, unitKey);
    if (!state.childFlowId) throw new Error(`unit "${unitKey}" has no child flow to cancel`);
    const active = db.all<{ node_key: string; status: string }>(
      `SELECT node_key, status FROM nodes WHERE flow_id=?`, state.childFlowId)
      .filter((n) => NODE_ACTIVE_STATUSES.includes(n.status));
    for (const n of active) {
      await this.e.cancelNode(state.childFlowId, n.node_key); // marks failed + stops in-flight runs
    }
    db.emitEvent(parentFlowId, null, "lifecycle",
      `split unit "${state.title}" cancelled`, { nodeKey: consumerNodeKey, unitKey, childFlowId: state.childFlowId });
    this.advance(parentFlowId, consumerNodeKey);
  }

  /** Standard stop for a child's active nodes (used by skip). */
  private async stopActiveChildNodes(childFlowId: string): Promise<void> {
    const active = db.all<{ node_key: string; status: string }>(
      `SELECT node_key, status FROM nodes WHERE flow_id=?`, childFlowId)
      .filter((n) => NODE_IN_FLIGHT_STATUSES.includes(n.status));
    for (const n of active) {
      await this.e.cancelNode(childFlowId, n.node_key);
    }
  }

  /** One unit's state by key (the actions' addressing). */
  private stateFor(parentFlowId: string, consumerNodeKey: string, unitKey: string): SplitUnitState {
    const state = this.unitStates(parentFlowId, consumerNodeKey).find((s) => s.key === unitKey);
    if (!state) {
      throw new Error(`no split unit "${unitKey}" on ${consumerNodeKey} of flow ${parentFlowId}`);
    }
    return state;
  }
}

/** Shared split runtime manager — bound to the flow engine by flow-engine.ts
 *  at load. Constructor-injected linkage (the `SplitLinkIndex` seam) so a
 *  future `split_units` table swap never ripples into the manager. */
export const splitManager = processSingleton("splitManager", () => new SplitManager());
