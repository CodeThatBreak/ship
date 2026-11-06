/**
 * In-memory {@link AgentPort} for engine characterization tests (engine
 * overhaul step 00). One instance per test file; registered into the global
 * `agentPortRegistry` by {@link registerFakeAgentPort}.
 *
 * Scripted runs: every `start()` returns a durable-looking handle; `stream()`
 * and `getRun()` pop the next scripted outcome in call order (the last one
 * repeats, mirroring the repo's existing stub-port convention). The fake
 * records every start/follow-up/cancel so tests assert at the port boundary
 * instead of engine internals.
 */
import type {
  AgentPort,
  AgentRunQuery,
  AgentRunResult,
  AgentRunUsage,
  AgentStartSpec,
  AgentStarted,
  AgentStreamOutcome,
} from "@/lib/engine/ports/agentPort";
import { agentPortRegistry } from "@/lib/engine/ports/agentPort";

export type AgentCall =
  | { kind: "start"; spec: AgentStartSpec }
  | { kind: "followUp"; runId: string; agentId: string | null | undefined; prompt: string | null }
  | { kind: "cancel"; runId: string };

export class FakeAgentPort implements AgentPort {
  readonly kind = "fake-overhaul";
  readonly label = "Fake overhaul agent";
  readonly execMode = "cloud" as const;
  readonly harness = "fake-overhaul";
  readonly fallbackModels = [] as const;
  readonly listDiscount = 0;

  readonly calls: AgentCall[] = [];
  /** When true, every getRun() answers {state:"running"} (mid-wait probes). */
  runningForever = false;

  private readonly outcomes: AgentRunResult[] = [];
  private counter = 0;
  private readonly cancelled = new Set<string>();

  /** Queue a terminal (or probeable) run result; the last one repeats. */
  pushRun(outcome: AgentRunResult): void {
    this.outcomes.push(outcome);
  }

  /**
   * Empty the scripted-outcome queue. The "last outcome repeats" convention
   * keeps a sticky tail after a node's self-heal retry consumes a duplicate —
   * drain between stages so the next pushRun() is the next run's outcome.
   */
  drainQueue(): void {
    this.outcomes.length = 0;
  }

  /** Every start() prompt so far, verbatim. */
  prompts(): string[] {
    return this.calls.flatMap((c) => (c.kind === "start" ? [c.spec.prompt] : []));
  }

  /** Runs cancelled via cancel() (reconcile-side effects use it). */
  wasCancelled(runId: string): boolean {
    return this.cancelled.has(runId);
  }

  private nextOutcome(): AgentRunResult {
    const next = this.outcomes.shift();
    if (next == null) {
      throw new Error(
        "FakeAgentPort: run streamed with an empty scripted-outcome queue — push one with pushRun()",
      );
    }
    if (this.outcomes.length === 0) this.outcomes.push(next);
    return next;
  }

  async start(spec: AgentStartSpec): Promise<AgentStarted> {
    this.calls.push({ kind: "start", spec });
    if (spec.followUpOn != null) {
      this.calls.push({
        kind: "followUp",
        runId: `run_fake_${this.counter + 1}`,
        agentId: spec.followUpOn,
        prompt: spec.prompt,
      });
    }
    this.counter += 1;
    return { agentId: `agt_fake_${this.counter}`, runId: `run_fake_${this.counter}` };
  }

  async stream(): Promise<AgentStreamOutcome> {
    const outcome = this.nextOutcome();
    return { result: { ...outcome }, sessionId: null };
  }

  async getRun(handle: { runId: string }): Promise<AgentRunQuery> {
    if (this.runningForever) return { state: "running" };
    if (this.cancelled.has(handle.runId)) {
      return { state: "terminal", result: { status: "cancelled" } };
    }
    return { state: "terminal", result: this.nextOutcome() };
  }

  async cancel(handle: { runId: string }): Promise<boolean> {
    this.calls.push({ kind: "cancel", runId: handle.runId });
    this.cancelled.add(handle.runId);
    return true;
  }

  hasActiveRun(): boolean {
    return false;
  }

  releaseActiveRun(): void {}

  async getUsage(): Promise<AgentRunUsage | null> {
    return null;
  }

  async inspectSession(): Promise<{ completed: boolean; text: string } | null> {
    return null;
  }

  async listCatalog(): Promise<null> {
    return null;
  }

  async status(): Promise<{ configured: boolean }> {
    return { configured: true };
  }
}

/**
 * Register a fresh fake into the global registry and select it as the default
 * harness so `forMode("cloud")` resolves it. The registry singleton forbids
 * duplicate kinds and the DB singleton forbids a second process-wide
 * `default_harness`, so one call per test file (top level, like the repo's
 * existing stub-port tests).
 */
export const registerFakeAgentPort = (setDefaultHarness: (value: string) => void): FakeAgentPort => {
  const fake = new FakeAgentPort();
  agentPortRegistry.register(fake);
  setDefaultHarness(fake.harness);
  return fake;
};
