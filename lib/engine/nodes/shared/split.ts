import "server-only";

import { z } from "zod";
import { validateAgainstContract, type StartContractField } from "../kinds/start/contract";

/**
 * The agent-node split contracts (agent-node split plan §2 — Phase 1:
 * contracts only, zero behavior). Nothing here is wired into a runtime path
 * yet: `NodeDefinition` exposes the producer port as default-null methods,
 * the schemas declare what a source/consumer MAY configure, and the target
 * resolver + cycle detector are pure functions the split runtime (Phase 2)
 * will call. No db / registry imports — the resolution seams are injected
 * ports so every contract is testable without a database.
 */

// ── §2.1 the producer port's unit ─────────────────────────────────────────────

export interface SplitUnit {
  /** stable identity across re-expansions (a re-run adds children for new
   *  units only — unchanged units keep their child runs) */
  key: string;
  title: string;
  /** declared ordering — the ONLY scheduling input. Eligible = all deps
   *  resolved + slot free. No inferred safety: the producer owns semantics. */
  dependsOn: string[];
  /** default target from the split config; a unit may override — a node key
   *  or a template id (resolution in §2.3) */
  target?: string;
  /** the unit's data — rides to the child as its input (`{{input.unit.*}}`).
   *  File scopes and every other domain attribute live HERE, in item data —
   *  the contract carries only what the engine reads (key, title, dependsOn,
   *  target). */
  item: unknown;
}

// ── §2.3 target resolution (template OR node) ─────────────────────────────────

/** Where a unit goes: a builtin chain node in this flow (e.g. "build") or a
 *  declarative `node_templates` row. */
export type SplitTarget =
  | { kind: "node"; key: string }
  | { kind: "template"; id: string };

/** Authoring errors surfaced by target resolution and the compatibility
 *  check — loud, like a contract failure (the plan's stated policy). */
export class SplitTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SplitTargetError";
  }
}

/**
 * The names a split target is resolved against, injected so this module
 * stays pure (no db / registry imports). The production adapter
 * (`flowSplitTargetLookup`) backs it with the node registry and the
 * template store; tests pass their own.
 */
export interface SplitTargetLookup {
  /** is `key` a builtin chain node key? */
  isNodeKey(key: string): boolean;
  /** the declarative `node_templates` row matching an id or catalog key
   *  (builtin knob-override rows are NOT targets), or null */
  template(idOrKey: string): { id: string } | null;
}

/**
 * Resolve one split target (§2.3): a node key → `{kind:"node"}`, a
 * node_templates row id/key → `{kind:"template"}`. A target matching both
 * is an authoring error — keys and template ids live in disjoint registries,
 * so a collision means a broken authoring surface; assert it. Unknown
 * targets are equally loud.
 */
export function resolveSplitTarget(target: string, lookup: SplitTargetLookup): SplitTarget {
  const isNode = lookup.isNodeKey(target);
  const row = lookup.template(target);
  if (isNode && row) {
    throw new SplitTargetError(
      `split target "${target}" is ambiguous — it matches both a node key and a node template ("${row.id}")`
    );
  }
  if (isNode) return { kind: "node", key: target };
  if (row) return { kind: "template", id: row.id };
  throw new SplitTargetError(`unknown split target "${target}" — not a node key or a node template`);
}

/**
 * Authoring-time compatibility check (§2.3): a `template` target's start
 * contract must accept the unit's item shape (exactly like a webhook
 * delivery — `validateAgainstContract`). A template declaring no fields
 * accepts anything. A `node` target declares its split-capable input via
 * the `split_consume` knob (§2.4) — Phase 4 wires that knob, so node
 * targets pass until then.
 *
 * `contractFields` is injected (the caller loads the target template's
 * start contract the way the fan-out manager does) so the check is pure.
 * Throws `SplitTargetError` on mismatch.
 */
export function assertSplitTargetCompatible(
  target: SplitTarget,
  item: unknown,
  contractFields: StartContractField[],
): void {
  if (target.kind === "node") return; // split-capability = the `split_consume` knob (Phase 4)
  if (!contractFields.length) return;
  const v = validateAgainstContract(contractFields, item);
  if (!v.ok) {
    throw new SplitTargetError(
      `the unit item doesn't match the target template "${target.id}" start contract — ${v.error}`
    );
  }
}

// ── §3 (expansion) unit-DAG cycle detection ───────────────────────────────────

/** A cycle in the declared unit dependencies — a producer error, loud like a
 *  contract failure. `path` is the closed walk, e.g. ["a", "b", "a"]. */
export class UnitCycleError extends Error {
  /** the cycle path, first and last element the same unit key */
  readonly path: string[];

  constructor(path: string[]) {
    super(`unit dependency cycle: ${path.join(" → ")}`);
    this.name = "UnitCycleError";
    this.path = path;
  }
}

/**
 * Detect a cycle in the units' declared `dependsOn` DAG — pure, the split
 * manager runs it at expansion time (§3). Dependencies pointing at unknown
 * unit keys are not cycles (scheduling owns unresolvable deps); duplicate
 * unit keys are the producer's bug and not detected here.
 * Returns the cycle path or null when the DAG is acyclic.
 */
export function detectUnitCycle(units: SplitUnit[]): string[] | null {
  const deps = new Map<string, string[]>();
  for (const u of units) deps.set(u.key, u.dependsOn);

  // 0 = unvisited, 1 = on the current DFS path, 2 = fully explored
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];

  const visit = (key: string): string[] | null => {
    const s = state.get(key) ?? 0;
    if (s === 1) {
      const start = stack.indexOf(key);
      return start >= 0 ? [...stack.slice(start), key] : [key, key];
    }
    if (s === 2) return null;
    state.set(key, 1);
    stack.push(key);
    for (const dep of deps.get(key) ?? []) {
      if (!deps.has(dep)) continue; // unknown dep — not a cycle
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(key, 2);
    return null;
  };

  for (const key of deps.keys()) {
    const cycle = visit(key);
    if (cycle) return cycle;
  }
  return null;
}

// ── §2.4 the consumer knob (`split_consume`) ──────────────────────────────────

/** How the consumer runs on a source's output — the next node decides
 *  (§1): whole = one run, full output (today's edge semantics); per-unit =
 *  one run per unit, then join; source = defer to the producer's
 *  `splitResolution()`. Phase 1 declares the vocabulary only — Phase 4
 *  wires it into def config schemas / configFields. */
export const SPLIT_CONSUME_MODES = ["whole", "per-unit", "source"] as const;
export type SplitConsumeMode = (typeof SPLIT_CONSUME_MODES)[number];

/** The zero-behavior default — every consumer consumes `whole` unless configured. */
export const DEFAULT_SPLIT_CONSUME: SplitConsumeMode = "whole";

/** Zod fragment for the knob (default = today's behavior). Not yet wired
 *  into any def's `configSchema`/`configFields` — that is Phase 4. */
export const splitConsumeSchema = z.enum(SPLIT_CONSUME_MODES).default(DEFAULT_SPLIT_CONSUME);

/**
 * Defensive read of the flat `split_consume` knob from a merged config
 * layer — snapshots ride raw into `run(config)` on the built-in kinds, and
 * unknown or invalid values bow out to `whole` (never throw a run down),
 * same policy as `fanoutOf`.
 */
export function splitConsumeOf(cfg: Record<string, unknown> | null | undefined): SplitConsumeMode {
  const v = cfg?.split_consume;
  if (typeof v === "string" && (SPLIT_CONSUME_MODES as readonly string[]).includes(v)) {
    return v as SplitConsumeMode;
  }
  return DEFAULT_SPLIT_CONSUME;
}

// ── §2.4 the parallel knob (`split_parallel_max`) ─────────────────────────────

/** The default parallelism — one unit at a time (§3: parallelism is opt-in). */
export const DEFAULT_SPLIT_PARALLEL_MAX = 1;

/** Zod fragment for the flat `split_parallel_max` knob — wired beside
 *  `splitConsumeSchema` into every split-capable consumer's config schema. */
export const splitParallelMaxSchema = z.number().int().min(1).default(DEFAULT_SPLIT_PARALLEL_MAX);

/**
 * Defensive read of the flat `split_parallel_max` knob from a merged config
 * layer — non-integer or sub-1 values bow out to 1 (never throw a run down),
 * same policy as `splitConsumeOf`.
 */
export function splitParallelMaxOf(cfg: Record<string, unknown> | null | undefined): number {
  const v = cfg?.split_parallel_max;
  if (typeof v === "number" && Number.isFinite(v) && v >= 1) return Math.floor(v);
  return DEFAULT_SPLIT_PARALLEL_MAX;
}
