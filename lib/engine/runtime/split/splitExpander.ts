import "server-only";

import { db } from "../../../db/app";
import { NodeDefinition } from "../../nodes/shared/nodeSharedExports";
import {
  SplitTargetError,
  UnitCycleError,
  assertSplitTargetCompatible,
  detectUnitCycle,
  resolveSplitTarget,
  splitConsumeOf,
  type SplitConsumeMode,
  type SplitTarget,
  type SplitUnit,
} from "../../nodes/shared/split";
import { flowSplitTargetLookup } from "../../nodes/shared/splitLookup";
import { parseStartContract, type StartContractField } from "../../nodes/kinds/start/contract";
import { configString } from "../../templates/nodeConfig";
import { templateStore } from "../../templates/templateStore";
import type { SplitChildPayload } from "./types/splitChildPayload";
import type { SplitEngineSurface } from "./types/splitEngineSurface";
import type { SplitLinkIndex } from "./types/splitLinkIndex";
import type { SplitJoin } from "./splitJoin";
import { must } from "./utils/must";
import { stripSplitKeys } from "./utils/stripSplitKeys";

/**
 * SplitExpander — the split runtime's gate and expansion (step 07
 * decomposition of `SplitManager`): decides whether a consumer node's stage
 * belongs to the split runtime at all (`stageGate`/`stageSource` — the
 * consumes handoff the stage runner delegates to, including the nesting
 * guard and the several-sources-fail-loudly rule), expands a per-unit
 * consumer into one child flow per published unit (`expand`, reconciling on
 * `unit.key` stability), and derives the child graph
 * (`templateContractFields`/`createChildFor`/`unitChildTemplateId`).
 *
 * Children are ordinary flows created through the narrower
 * `flowEngine.createSplitChild` (the snapshot machinery of createStepChild,
 * minus the step payload's start-contract validation — the expander validates
 * each unit's item against its target's contract before any row exists).
 * The graph a child runs is the graph the target denotes (recommendation 2):
 * both target kinds resolve through the Phase-1 lookup and auto-wrap into a
 * hidden single-node child template — a `node` target wraps the built-in
 * catalog row (integration semantics: the child delivers into the parent), a
 * `template` target wraps the declarative `node_templates` row, whose def
 * hydrates exactly as it does in any template (delivery semantics).
 *
 * Invariants upheld:
 * - Producer errors (cycles, unknown/duplicate targets, contract mismatches)
 *   throw loudly BEFORE any child row exists — the engine's trigger path
 *   fails the consumer node on the throw, exactly like a contract failure.
 * - No nesting: children never split — a `per-unit` consumer inside a child
 *   flow resolves to `whole`, enforced here, not by convention.
 * - Re-expansion reconciles on `unit.key` stability: unchanged units keep
 *   their child flows — never recreated.
 * - Several upstream sources publishing units fail loudly — the engine never
 *   picks one.
 *
 * Must never:
 * - write `nodes.status` or publish transitions (the expansion only creates
 *   child rows and hands off to the `SplitJoin`'s scheduler);
 * - publish the consumer's aggregate — the join belongs to `SplitJoin`;
 * - import the flowEngine value directly (the singleton cycle resolves
 *   through the bound `SplitEngineSurface`).
 */
export class SplitExpander {
  constructor(
    private readonly engine: () => SplitEngineSurface,
    private readonly linkage: SplitLinkIndex,
    /** the join is wired beside this class (the facade's construction order);
     *  expansion's tail hands off to its scheduler */
    private readonly join: SplitJoin,
  ) {}

  private get e(): SplitEngineSurface {
    return this.engine();
  }

  /**
   * The split runtime's stage-ownership gate (step 07): resolve the consumer's
   * upstream split source (the consumes handoff) and engage the expansion when
   * one applies. True when this runtime owns the node's stage (the caller
   * returns; the join publishes through the registry's child-terminal path),
   * false when the whole path runs unchanged.
   */
  async stageGate(flowId: string, nodeKey: string): Promise<boolean> {
    const sourceKey = await this.stageSource(flowId, nodeKey);
    if (sourceKey == null) return false;
    return this.expand(flowId, nodeKey, sourceKey, { consume: "per-unit" });
  }

  /**
   * The upstream source a consumer takes units from (agent-node split plan
   * §2.4): null when the node takes the whole output — its knob, the nesting
   * guard, or the source's resolution says so, or no upstream def publishes
   * units. Several publishing sources fail loudly — the engine never picks
   * one.
   */
  private async stageSource(flowId: string, nodeKey: string): Promise<string | null> {
    const mode = splitConsumeOf(await this.e.nodeConfigFor(flowId, nodeKey));
    if (mode === "whole") return null;
    if (await this.e.isStepChild(flowId)) return null; // nesting guard (§3)
    const g = await templateStore.graphForFlow(flowId);
    if (!g) return null;
    const sources: string[] = [];
    for (const e of g.edges) {
      if (e.kind !== "next" || e.to !== nodeKey) continue;
      const def = await this.e.defOf(flowId, e.from);
      if (def.splitUnits !== NodeDefinition.prototype.splitUnits) sources.push(e.from);
    }
    if (!sources.length) return null; // no upstream def publishes units — whole path
    if (sources.length > 1) {
      throw new Error(
        `${nodeKey} consumes split units but several upstream nodes publish them (${sources.join(", ")}) — route through one split source per consumer, or consume whole`);
    }
    const sourceKey = sources[0];
    const effective: SplitConsumeMode = mode === "per-unit"
      ? "per-unit" // explicit consumer choice wins over the recommendation (§2.4)
      : await (await this.e.defOf(flowId, sourceKey)).splitResolution(await this.e.ctx(flowId)) ?? "whole"; // absent ⇒ whole
    return effective === "per-unit" ? sourceKey : null;
  }

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
      if (attemptId) this.join.captureAttempt(parentFlowId, consumerNodeKey, attemptId);
      await db.emitEvent(parentFlowId, null, "lifecycle",
        `${consumerNodeKey} splits into ${made} unit child flow${made > 1 ? "s" : ""} — one child per published unit`,
        { nodeKey: consumerNodeKey });
    }
    await this.join.advance(parentFlowId, consumerNodeKey);
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
}
