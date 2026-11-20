import "server-only";

import { CursorCloudAgentPort } from "../../../integrations/cursor/agentPort";
import { CursorLocalAgentPort } from "../../../integrations/localAgent/agentPort";
import { defaultHarnessSetting } from "./utils/defaultHarnessSetting";
import type {
  AgentPort,
} from "./types/agentPort";

/**
 * The agent-port registry — mirrors `GitHostRegistry` (lib/engine/ports/
 * git-host.ts): adding a runtime = one adapter file + one `register()` line.
 * Several ports may share an execution mode (one per harness): selection
 * prefers the port of the harness chosen on the Settings page
 * (`default_harness`), so a later-integrated harness takes over a mode
 * without touching the engine.
 */
export class AgentPortRegistry {
  private readonly registry = new Map<string, AgentPort>();
  private builtinsReady = false;

  constructor(
    /**
     * Resolves the configured default harness key, or null for "no
     * preference". Tests inject their own (and disable the builtins) to keep
     * the DB isolated. May return the key directly or as a promise (the
     * built-in resolver reads the async settings store).
     */
    private readonly resolveDefaultHarness: () => string | null | Promise<string | null> = defaultHarnessSetting,
    private readonly withBuiltins = true,
  ) {}

  private ensureBuiltins(): void {
    if (!this.withBuiltins || this.builtinsReady) return;
    this.builtinsReady = true;
    this.registerBuiltins();
  }

  private registerBuiltins(): void {
    this.register(new CursorCloudAgentPort());
    this.register(new CursorLocalAgentPort());
  }

  register(port: AgentPort): void {
    if (this.registry.has(port.kind)) {
      throw new Error(`duplicate agent port kind: ${port.kind}`);
    }
    this.registry.set(port.kind, port);
  }

  /** Get a port by kind, or throw. */
  get(kind: string): AgentPort {
    this.ensureBuiltins();
    const p = this.registry.get(kind);
    if (!p) throw new Error(`unknown agent port kind: ${kind}`);
    return p;
  }

  /** Get a port by kind, or undefined. */
  maybe(kind: string): AgentPort | undefined {
    this.ensureBuiltins();
    return this.registry.get(kind);
  }

  /** All registered ports (registration order). */
  list(): AgentPort[] {
    this.ensureBuiltins();
    return [...this.registry.values()];
  }

  /**
   * The port backing a flow execution mode. When the configured default
   * harness (`default_harness`) registers a port for the mode, that port
   * wins; otherwise the first registered port for the mode (today's
   * single-harness installs see no change). Unknown/unregistered keys fall
   * back too, so a stale setting can never hard-fail a run.
   */
  async forMode(mode: "cloud" | "local"): Promise<AgentPort> {
    this.ensureBuiltins();
    const harness = await this.resolveDefaultHarness();
    const chosen = (harness
      ? this.list().find((x) => x.harness === harness && x.execMode === mode)
      : undefined) ?? this.list().find((x) => x.execMode === mode);
    if (!chosen) {
      throw new Error(`no agent runner configured for execution mode "${mode}"`);
    }
    return chosen;
  }
}
