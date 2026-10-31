import "server-only";

import type { TaskProvider } from "./task-provider";
import { JiraTaskProvider } from "./providers/jira";

/**
 * The single source of truth for task types.
 *
 * Adding a new task type:
 *   1. Create `lib/engine/tasks/providers/<kind>.ts` — a `TaskProvider`
 *      subclass (liveFetch, upsert-on-key materialization; optionally an
 *      instance registry for the Integrations → Task tab).
 *   2. Add one `this.register(new ...Provider())` line in `registerBuiltins()`.
 *
 * Everything else — the provider list (GET /api/tasks/providers), the
 * homepage's task-type filters, and the {{task.*}} context-field vocabulary —
 * derives from here.
 */
export class TaskProviderRegistry {
  private readonly registry = new Map<string, TaskProvider>();

  constructor() {
    this.registerBuiltins();
  }

  register(provider: TaskProvider): void {
    if (this.registry.has(provider.kind)) {
      throw new Error(`duplicate task provider kind: ${provider.kind}`);
    }
    this.registry.set(provider.kind, provider);
  }

  /** The built-in task types. */
  private registerBuiltins(): void {
    this.register(new JiraTaskProvider());
  }

  /** Get a provider by kind, or throw. */
  get(kind: string): TaskProvider {
    const provider = this.registry.get(kind);
    if (!provider) throw new Error(`unknown task provider kind: ${kind}`);
    return provider;
  }

  /** Get a provider by kind, or undefined. */
  maybe(kind: string): TaskProvider | undefined {
    return this.registry.get(kind);
  }

  has(kind: string): boolean {
    return this.registry.has(kind);
  }

  /** All registered providers (registration order). */
  list(): TaskProvider[] {
    return [...this.registry.values()];
  }

  /** Serialized provider list — shared by GET /api/tasks/providers and loaders. */
  describe(): {
    kind: string;
    label: string;
    configured: boolean;
    contextFields: TaskProvider["contextFields"];
  }[] {
    return this.list().map((p) => ({
      kind: p.kind,
      label: p.label,
      configured: p.configured(),
      contextFields: p.contextFields,
    }));
  }

  /**
   * The default provider for syncs that don't request a kind — the first
   * registration while a single provider exists. Once more providers ship,
   * the UI passes `kind` explicitly.
   */
  first(): TaskProvider | undefined {
    return this.list()[0];
  }
}

export const taskRegistry = new TaskProviderRegistry();
