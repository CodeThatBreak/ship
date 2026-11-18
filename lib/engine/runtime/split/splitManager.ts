import "server-only";

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "../../../db/app";
import { FLOW_STATUS } from "../../../../constants/flow";
import {
  NODE_ACTIVE_STATUSES,
  NODE_IN_FLIGHT_STATUSES,
  NODE_SUCCESS_STATUSES,
  NODE_TERMINAL_STATUSES,
} from "../transitions/constants/statusSets";
import type { TransitionKey } from "../transitions/types/transitions";
import { engineParts } from "@/lib/composition/container";
import { processSingleton } from "../../../singleton";
import type { FlowCtx, NodeDefinition } from "../../nodes/shared/nodeSharedExports";
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
import { flowSplitTargetLookup } from "../../nodes/shared/splitLookup";
import { parseStartContract, type StartContractField } from "../../nodes/kinds/start/contract";
import { configString } from "../../templates/nodeConfig";
import { templateStore } from "../../templates/templateStore";

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
  linksOf(parentFlowId: string, consumerNodeKey: string): Promise<SplitChildLink[]>;
  /** one child flow's payload, or null when the flow carries no split linkage */
  childPayloadOf(childFlowId: string): Promise<SplitChildPayload | null>;
  /** the consumer node that owns a unit key on this parent (the per-unit
   *  actions' optional addressing), or null when no split linkage carries it */
  consumerNodeOfUnit(parentFlowId: string, unitKey: string): Promise<string | null>;
}

/** A required row: throws instead of a `!` assertion (AGENTS.md §3.4). */
function must<T>(row: T | undefined, what: string): T {
  if (row == null) throw new Error(`missing row: ${what}`);
  return row;
}

/** Defensive payload parse (unparseable / foreign payload → null). */
function parseSplitPayload(raw: unknown): SplitChildPayload | null {
  if (raw == null) return null;
  try {
    const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as SplitChildPayload | null;
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
  async linksOf(parentFlowId: string, consumerNodeKey: string): Promise<SplitChildLink[]> {
    const rows = await db.prisma.flow.findMany({
      where: { parentFlowId, kind: "split" }, select: { id: true, triggerPayload: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const links: SplitChildLink[] = [];
    for (const r of rows) {
      const payload = parseSplitPayload(r.triggerPayload);
      if (!payload || payload.parentNodeKey !== consumerNodeKey) continue;
      links.push({ childFlowId: r.id, unitKey: payload.unit.key, unit: payload.unit });
    }
    return links.sort((a, b) => a.unit.position - b.unit.position);
  }

  async childPayloadOf(childFlowId: string): Promise<SplitChildPayload | null> {
    const row = await db.prisma.flow.findUnique({ where: { id: childFlowId }, select: { triggerPayload: true } });
    return parseSplitPayload(row?.triggerPayload);
  }

  async consumerNodeOfUnit(parentFlowId: string, unitKey: string): Promise<string | null> {
    const rows = await db.prisma.flow.findMany({
      where: { parentFlowId, kind: "split" }, select: { triggerPayload: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    for (const r of rows) {
      const payload = parseSplitPayload(r.triggerPayload);
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
  ctx(flowId: string): Promise<FlowCtx>;
  defOf(flowId: string, nodeKey: string): Promise<NodeDefinition<unknown, Record<string, unknown>>>;
  nodeConfigFor(flowId: string, nodeKey: string): Promise<Record<string, unknown>>;
  createSplitChild(
    parentFlowId: string,
    templateId: string,
    name: string,
    payload: SplitChildPayload
  ): Promise<string>;
  startStepChild(childFlowId: string): Promise<void>;
  finishSplit(parentFlowId: string, nodeKey: string, output: Record<string, unknown>, attemptId?: string | null): Promise<void>;
  setNodeStatus(flowId: string, nodeKey: string, key: TransitionKey): Promise<boolean>;
  retryNode(flowId: string, nodeKey: string): Promise<void>;
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

  // Consumer attempt tokens captured at expand — the join's aggregate publish is attempt-fenced
  // (stale aggregates lose to the user's re-claim; step 03 makes this durable).
  private readonly consumerAttempts = new Map<string, string>();
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
  async expand(
    parentFlowId: string,
    consumerNodeKey: string,
    sourceNodeKey: string,
    // the engine's split gate passes the RESOLVED mode: a `source` consumer
    // deferring to a per-unit recommendation has raw config `split_consume:
    // "source"` here (Phase 4); direct callers omit it and the config decides
    opts: { consume?: SplitConsumeMode } = {},
  ): Promise<boolean> {
    const flow = await db.prisma.flow.findUnique({ where: { id: parentFlowId }, select: { parentFlowId: true } });
    if (!flow) throw new Error(`parent flow ${parentFlowId} not found`);
    // nesting guard (§3): children never split — a `per-unit` consumer inside
    // a child flow resolves to `whole`, enforced here, not by convention
    if (flow.parentFlowId != null) return false;
    const consume = opts.consume ?? splitConsumeOf(await this.e.nodeConfigFor(parentFlowId, consumerNodeKey));
    if (consume !== "per-unit") return false;
    const ctx = await this.e.ctx(parentFlowId);
    const units = await (await this.e.defOf(parentFlowId, sourceNodeKey)).splitUnits(ctx);
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
    const defaultTarget = configString(await this.e.nodeConfigFor(parentFlowId, sourceNodeKey), "split_target");
    const resolved = await Promise.all(units.map(async (unit, position) => {
      const target = await resolveSplitTarget(unit.target ?? defaultTarget ?? "", flowSplitTargetLookup);
      await assertSplitTargetCompatible(target, unit.item, await this.templateContractFields(target));
      return { unit, position, target };
    }));

    const existing = new Map((await this.linkage.linksOf(parentFlowId, consumerNodeKey)).map((l) => [l.unitKey, l.childFlowId]));
    let made = 0;
    for (const r of resolved) {
      if (existing.has(r.unit.key)) continue; // unchanged unit keeps its child (§2.1)
      await this.createChildFor(parentFlowId, consumerNodeKey, r.unit, r.position, r.target);
      made++;
    }
    if (!made && !existing.size) return false;
    if (made) {
      const attemptId = (await db.prisma.node.findFirst({ where: { flowId: parentFlowId, nodeKey: consumerNodeKey }, select: { attemptId: true } }))?.attemptId;
      if (attemptId) this.consumerAttempts.set(`${parentFlowId}\n${consumerNodeKey}`, attemptId);
      await db.emitEvent(parentFlowId, null, "lifecycle",
        `${consumerNodeKey} splits into ${made} unit child flow${made > 1 ? "s" : ""} — one child per published unit`,
        { nodeKey: consumerNodeKey });
    }
    await this.advance(parentFlowId, consumerNodeKey);
    return true;
  }

  /** The target's start contract fields (the unit-item compatibility check
   *  rides the same contract parsing the fan-out manager uses). A `template`
   *  target's contract is the declarative row's `contract` config block
   *  (absent = accepts anything); a `node` target declares its split-capable
   *  input via the `split_consume` knob instead (Phase 4). */
  private async templateContractFields(target: SplitTarget): Promise<StartContractField[]> {
    if (target.kind === "node") return [];
    const row = await templateStore.nodeTemplate(target.id);
    if (!row) throw new SplitTargetError(`split target template "${target.id}" does not exist`);
    return parseStartContract(row.config);
  }

  /** Create one child flow for a unit (the target decides the graph shape —
   *  recommendation 2) and persist the linkage in its payload (decision 1). */
  private async createChildFor(
    parentFlowId: string,
    consumerNodeKey: string,
    unit: SplitUnit,
    position: number,
    target: SplitTarget
  ): Promise<string> {
    const templateId = await this.unitChildTemplateId(parentFlowId, target);
    const payload: SplitChildPayload = {
      parentNodeKey: consumerNodeKey,
      unit: { key: unit.key, title: unit.title, dependsOn: [...unit.dependsOn], item: unit.item, position },
    };
    const name = (await db.prisma.flow.findUnique({ where: { id: parentFlowId }, select: { name: true } }))?.name ?? parentFlowId;
    const childId = await this.e.createSplitChild(parentFlowId, templateId, `${name} · unit: ${unit.title}`, payload);
    await db.emitEvent(parentFlowId, null, "lifecycle",
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
  private async unitChildTemplateId(parentFlowId: string, target: SplitTarget): Promise<string> {
    const row = target.kind === "template"
      ? must(await templateStore.nodeTemplate(target.id), `split target template row ${target.id}`)
      : must(await templateStore.nodeTemplateByKey(target.key), `split node target "${target.key}" catalog row`);
    if (target.kind === "node" && !row.isBuiltin) {
      throw new SplitTargetError(`split node target "${target.key}" is not a builtin node key`);
    }
    const instanceKey = target.kind === "template" ? row.key : target.key;
    const spec = target.kind === "node"
      ? (await templateStore.graphForFlow(parentFlowId))?.byKey.get(target.key)
      : undefined;
    const name = `${row.name} · unit`;
    const existing = (await templateStore.list({ includeHidden: true }))
      .find((t) => t.hidden === true && t.name === name);
    if (existing) return existing.id;
    const tplId = await templateStore.create({
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
    await db.prisma.flowTemplate.update({ where: { id: tplId }, data: { hidden: true, updatedAt: new Date() } });
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
  async advance(parentFlowId: string, consumerNodeKey: string): Promise<void> {
    const states = await this.unitStates(parentFlowId, consumerNodeKey);
    if (!states.length) return;
    const parallelMax = splitParallelMaxOf(
      await this.e.nodeConfigFor(parentFlowId, consumerNodeKey));
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
        await this.e.startStepChild(s.childFlowId); // fire-and-forget (engine bg) — keep filling free slots
        slots--;
      }
    }
    await this.checkJoin(parentFlowId, consumerNodeKey);
  }

  /** In-process start claims (see advance) — the split scheduler's guard
   *  against starting one unit's child twice while a previous start's bg run
   *  is still pending. */
  private claimedStarts = new Map<string, number>();

  // ── state derivation ────────────────────────────────────────────────────────

  /**
   * The consumer node key that owns a unit key on this flow (the per-unit
   * actions' optional addressing — the caller may address a unit by key
   * alone), or null when no split linkage on the flow carries it.
   */
  async consumerOfUnit(parentFlowId: string, unitKey: string): Promise<string | null> {
    return this.linkage.consumerNodeOfUnit(parentFlowId, unitKey);
  }

  /**
   * All unit states a consumer node owns, in unit (expansion) order — the
   * scheduler's, the join's and the actions' single view. Includes the
   * `blocked` closure: a pending unit whose dependency failed/skipped/blocked
   * (or is unknown — it could never resolve) can never start.
   */
  private async unitStates(parentFlowId: string, consumerNodeKey: string): Promise<SplitUnitState[]> {
    const links = await this.linkage.linksOf(parentFlowId, consumerNodeKey);
    const states: SplitUnitState[] = await Promise.all(links.map(async (link) => {
      const flow = await db.prisma.flow.findUnique({ where: { id: link.childFlowId }, select: { status: true } });
      const flowStatus = flow?.status ?? null;
      const statuses = (await db.prisma.node.findMany({
        where: { flowId: link.childFlowId }, select: { status: true }, orderBy: { createdAt: "asc" },
      })).map((n) => n.status);
      const status = SplitManager.unitStatusOf(statuses, flowStatus);
      return {
        key: link.unitKey,
        title: link.unit.title,
        dependsOn: link.unit.dependsOn,
        childFlowId: link.childFlowId,
        status,
        output: await this.childOutput(link.childFlowId),
      };
    }));
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
  private async childOutput(childFlowId: string): Promise<Record<string, unknown>> {
    const outs = await db.prisma.node.findMany({
      where: { flowId: childFlowId, output: { not: Prisma.DbNull } }, select: { output: true },
      orderBy: { updatedAt: "asc" },
    });
    const merged: Record<string, unknown> = {};
    for (const row of outs) {
      if (row.output == null) continue;
      try {
        const parsed = typeof row.output === "string" ? JSON.parse(row.output) : row.output;
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
    const states = await this.unitStates(parentFlowId, consumerNodeKey);
    if (!states.length) return;
    if (states.some((s) => s.status === "running")) return;
    // an unstarted unit whose dependencies are all done could still advance —
    // but only when a slot is actually free (an awaiting-approval unit holds
    // its slot until the user acts; nothing can advance around it — the join
    // publishes then, the awaiting entry surfacing in the worst-of status)
    const parallelMax = splitParallelMaxOf(
      await this.e.nodeConfigFor(parentFlowId, consumerNodeKey));
    const inFlight = states.filter((s) => s.status === "running" || s.status === "awaiting_approval").length;
    const couldAdvance = inFlight < parallelMax && states.some((s) =>
      s.status === "pending" && s.dependsOn.every((d) => states.find((x) => x.key === d)?.status === "done"));
    if (couldAdvance) return;
    const entries = states.map((s) => ({ key: s.key, title: s.title, status: s.status, output: s.output }));
    const worst = WORST_OF_PRECEDENCE.find((w) => entries.some((e) => e.status === w)) ?? "done";
    await this.e.finishSplit(parentFlowId, consumerNodeKey, { units: entries, worst }, this.consumerAttempts.get(`${parentFlowId}\n${consumerNodeKey}`) ?? null);
  }

  // ── child terminal hook (the engine's additive tail calls) ─────────────────

  /**
   * Notification hook — called from the engine's node-stage / retry / cancel
   * tails when a child flow reached a terminal state. No-op unless the flow
   * is a split child (linkage check first — the whole method is two queries
   * for non-split children), then reschedules the parent's units.
   */
  async onChildFinished(childFlowId: string): Promise<void> {
    const payload = await this.linkage.childPayloadOf(childFlowId);
    if (!payload?.parentNodeKey || !payload.unit?.key) return; // no split linkage
    const flow = await db.prisma.flow.findUnique({
      where: { id: childFlowId },
      select: { parentFlowId: true, kind: true, status: true },
    });
    if (!flow?.parentFlowId || flow.kind !== "split") return;
    // a multi-node (template-target) child mid-graph is not terminal yet —
    // intermediate node finishes don't reschedule the parent's units. An
    // `awaiting_approval` node DOES: the unit holds a scheduler slot until
    // the user acts, and the join accounts for it.
    const statuses = (await db.prisma.node.findMany({
      where: { flowId: childFlowId }, select: { status: true },
    })).map((n) => n.status);
    const flowClosed = flow.status === FLOW_STATUS.DONE || flow.status === FLOW_STATUS.SKIPPED;
    const allTerminal = statuses.length > 0
      && statuses.every((s) => NODE_TERMINAL_STATUSES.includes(s));
    const holding = statuses.some((s) => s === FLOW_STATUS.AWAITING_APPROVAL);
    if (!allTerminal && !holding && !flowClosed) return;
    await db.emitEvent(flow.parentFlowId, null, "lifecycle",
      `split unit "${payload.unit.title}" resolved`,
      { nodeKey: payload.parentNodeKey, childFlowId, unitKey: payload.unit.key });
    await this.advance(flow.parentFlowId, payload.parentNodeKey);
  }

  // ── per-unit actions (§3), addressed by unit.key through the linkage ────────

  /**
   * Skip a unit: stop in-flight runs, mark its nodes skipped, close the child
   * flow `skipped`, reschedule — dependents become `blocked`.
   */
  async skipUnit(parentFlowId: string, consumerNodeKey: string, unitKey: string): Promise<void> {
    const state = await this.stateFor(parentFlowId, consumerNodeKey, unitKey);
    if (!state.childFlowId) throw new Error(`unit "${unitKey}" has no child flow to skip`);
    if (state.status === "done" || state.status === "skipped") {
      throw new Error(`unit "${unitKey}" is already ${state.status}`);
    }
    await this.stopActiveChildNodes(state.childFlowId);
    await engineParts.transitions.applyFlowScope(state.childFlowId, "skipUnit"); // terminals never overwritten
    await db.prisma.flow.update({ where: { id: state.childFlowId }, data: { status: "skipped", updatedAt: new Date() } });
    await db.emitEvent(parentFlowId, null, "lifecycle",
      `split unit "${state.title}" skipped`, { nodeKey: consumerNodeKey, unitKey, childFlowId: state.childFlowId });
    await this.advance(parentFlowId, consumerNodeKey);
  }

  /** Retry a failed unit's child run (its recorded input). Blocked units have
   *  no failed run of their own — retry the failed dependency that blocks them. */
  async retryUnit(parentFlowId: string, consumerNodeKey: string, unitKey: string): Promise<void> {
    const state = await this.stateFor(parentFlowId, consumerNodeKey, unitKey);
    if (!state.childFlowId) throw new Error(`unit "${unitKey}" has no child flow to retry`);
    const failed = await db.prisma.node.findMany({
      where: { flowId: state.childFlowId, status: "failed" }, select: { nodeKey: true },
    });
    if (!failed.length) throw new Error(`unit "${unitKey}" has no failed node to retry`);
    await this.e.retryNode(state.childFlowId, failed[0].nodeKey); // hooks reschedule on finish
  }

  /**
   * Approve a unit holding at `awaiting_approval` — inline (not the generic
   * approveNode: that route sends child flows to the plan fan-out approve).
   */
  async approveUnit(parentFlowId: string, consumerNodeKey: string, unitKey: string): Promise<void> {
    const state = await this.stateFor(parentFlowId, consumerNodeKey, unitKey);
    if (!state.childFlowId) throw new Error(`unit "${unitKey}" has no child flow to approve`);
    const awaiting = await db.prisma.node.findMany({
      where: { flowId: state.childFlowId, status: "awaiting_approval" }, select: { nodeKey: true },
    });
    if (!awaiting.length) throw new Error(`unit "${unitKey}" is not awaiting approval`);
    for (const n of awaiting) {
      await this.e.setNodeStatus(state.childFlowId, n.nodeKey, "approve"); // raced-out nodes keep their real state
      await db.emitEvent(state.childFlowId, null, "lifecycle", `${n.nodeKey} approved`);
    }
    // the child's own graph continues past its approval gate, if it has one
    await this.e.advanceFrom(state.childFlowId, awaiting[0].nodeKey);
    await this.advance(parentFlowId, consumerNodeKey);
  }

  /** Cancel a unit: stop its active runs (standard stop), leaving the unit
   *  failed — its dependents surface `blocked`, the aggregate republishes. */
  async cancelUnit(parentFlowId: string, consumerNodeKey: string, unitKey: string): Promise<void> {
    const state = await this.stateFor(parentFlowId, consumerNodeKey, unitKey);
    if (!state.childFlowId) throw new Error(`unit "${unitKey}" has no child flow to cancel`);
    const active = (await db.prisma.node.findMany({
      where: { flowId: state.childFlowId }, select: { nodeKey: true, status: true },
    })).filter((n) => NODE_ACTIVE_STATUSES.includes(n.status));
    for (const n of active) {
      await this.e.cancelNode(state.childFlowId, n.nodeKey); // marks failed + stops in-flight runs
    }
    await db.emitEvent(parentFlowId, null, "lifecycle",
      `split unit "${state.title}" cancelled`, { nodeKey: consumerNodeKey, unitKey, childFlowId: state.childFlowId });
    await this.advance(parentFlowId, consumerNodeKey);
  }

  /** Standard stop for a child's active nodes (used by skip). */
  private async stopActiveChildNodes(childFlowId: string): Promise<void> {
    const active = (await db.prisma.node.findMany({
      where: { flowId: childFlowId }, select: { nodeKey: true, status: true },
    })).filter((n) => NODE_IN_FLIGHT_STATUSES.includes(n.status));
    for (const n of active) {
      await this.e.cancelNode(childFlowId, n.nodeKey);
    }
  }

  /** One unit's state by key (the actions' addressing). */
  private async stateFor(parentFlowId: string, consumerNodeKey: string, unitKey: string): Promise<SplitUnitState> {
    const state = (await this.unitStates(parentFlowId, consumerNodeKey)).find((s) => s.key === unitKey);
    if (!state) throw new Error(`no split unit "${unitKey}" on ${consumerNodeKey} of flow ${parentFlowId}`);
    return state;
  }
}

/** Shared split runtime manager — bound to the flow engine by flow-engine.ts
 *  at load. Constructor-injected linkage (the `SplitLinkIndex` seam) so a
 *  future `split_units` table swap never ripples into the manager. */
export const splitManager = processSingleton("splitManager", () => new SplitManager());
