import type { NodeDefinition } from "./base";
import { PlanNode } from "./plan";
import { BuildNode } from "./build";
import { PipelineNode } from "./pipeline";
import { ReviewNode } from "./review";
import { ResolveNode } from "./resolve";

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
  private readonly registry = new Map<string, NodeDefinition<any, any>>();

  constructor() {
    this.registerBuiltins();
  }

  register(def: NodeDefinition<any, any>): void {
    if (this.registry.has(def.key)) throw new Error(`duplicate node key: ${def.key}`);
    this.registry.set(def.key, def);
  }

  /** The built-in workflow. */
  private registerBuiltins(): void {
    this.register(new PlanNode());
    this.register(new BuildNode());
    this.register(new PipelineNode());
    this.register(new ReviewNode());
    this.register(new ResolveNode());
  }

  /** Get a node definition by key, or throw. */
  get(key: string): NodeDefinition<any, any> {
    const def = this.registry.get(key);
    if (!def) throw new Error(`unknown node key: ${key}`);
    return def;
  }

  /** Get a node definition by key, or undefined. */
  maybe(key: string): NodeDefinition<any, any> | undefined {
    return this.registry.get(key);
  }

  has(key: string): boolean {
    return this.registry.has(key);
  }

  /** All node definitions in graph order (ascending `order`). */
  all(): NodeDefinition<any, any>[] {
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
}

export const nodeRegistry = new NodeRegistry();
