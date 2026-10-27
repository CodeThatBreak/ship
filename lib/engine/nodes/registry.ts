import type { NodeDefinition } from "./shared";
import { PlanNode } from "./kinds/plan";
import { BuildNode } from "./kinds/build";
import { StepBuildNode } from "./kinds/build/step-build-node";
import { PipelineNode } from "./kinds/pipeline";
import { ReviewNode } from "./kinds/review";
import { ResolveNode } from "./kinds/resolve";
import { declarativeDef } from "./declarative";
import { StartNode } from "./kinds/start";

/**
 * The registry-level def shape: generics erased *honestly* (unknown /
 * Record<string, unknown>) instead of `any` (§T5/F10). `run()` implementations
 * treat input loosely across this boundary — defs `parseInput()` internally —
 * so the erasure is sound at every registry call site.
 */
type AnyNodeDef = NodeDefinition<unknown, Record<string, unknown>>;

/**
 * The single source of truth for the workflow graph.
 *
 * Adding a new node type:
 *   1. Create a folder for the node (schema.ts + <name>-node.ts + index.ts).
 *   2. Add one entry to `registerBuiltins()` below.
 *
 * Everything else — node rows at flow creation, graph edges/layout, retry,
 * chat routing, recovery, prompt templates, UI labels — derives from here.
 */
export class NodeRegistry {
  private readonly registry = new Map<string, AnyNodeDef>();

  constructor() {
    this.registerBuiltins();
  }

  register(def: AnyNodeDef): void {
    if (this.registry.has(def.key)) throw new Error(`duplicate node key: ${def.key}`);
    this.registry.set(def.key, def);
  }

  /** The built-in workflow. */
  private registerBuiltins(): void {
    this.register(new StartNode());
    this.register(new PlanNode());
    this.register(new BuildNode());
    this.register(new StepBuildNode()); // plan fan-out step child (Phase 1C)
    this.register(new PipelineNode());
    this.register(new ReviewNode());
    this.register(new ResolveNode());
  }

  /** Get a node definition by key, or throw. */
  get(key: string): AnyNodeDef {
    const def = this.registry.get(key);
    if (!def) throw new Error(`unknown node key: ${key}`);
    return def;
  }

  /** Get a node definition by key, or undefined. */
  maybe(key: string): AnyNodeDef | undefined {
    return this.registry.get(key);
  }

  /**
   * Resolve by def key — built-ins by registry key, declarative kinds (agent, …)
   * by their `node_templates` row id, hydrating a runtime instance on demand.
   * `inst` is the template instance key (node_key) for declarative defs.
   */
  resolve(key: string, inst?: string): AnyNodeDef {
    const builtin = this.registry.get(key);
    if (builtin) return builtin;
    const def = declarativeDef(key, inst);
    if (def) return def;
    throw new Error(`unknown node type: ${key}`);
  }

  has(key: string): boolean {
    return this.registry.has(key);
  }

  /** All node definitions in graph order (ascending `order`). */
  all(): AnyNodeDef[] {
    return [...this.registry.values()].sort((a, b) => a.order - b.order);
  }

  /** Node keys in graph order — used for display + node-row creation. */
  order(): string[] {
    return this.all().map((d) => d.key);
  }

  /**
   * Graph edges as [from, to, kind] tuples, derived from each node's `edges`.
   * Used by the workflow graph UI.
   */
  edges(): [string, string, "next" | "loop"][] {
    const out: [string, string, "next" | "loop"][] = [];
    for (const def of this.registry.values()) {
      for (const [target, kind] of def.edges) {
        out.push([def.key, target, kind]);
      }
    }
    return out;
  }

  /** Node metadata for the UI: key → { label }. */
  meta(): Record<string, { label: string }> {
    const out: Record<string, { label: string }> = {};
    for (const def of this.registry.values()) {
      out[def.key] = { label: def.label };
    }
    return out;
  }

  /** The registry key of the node kind that opens a flow (the entry/start kind). */
  entryKey(): string | null {
    return this.all().find((d) => d.isEntry)?.key ?? null;
  }
}

export const nodeRegistry = new NodeRegistry();
