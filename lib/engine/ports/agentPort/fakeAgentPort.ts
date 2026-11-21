import "server-only";

import { RUN_MODE, type RunMode } from "../../../../constants/execution";
import { HARNESS_KEYS } from "../../constants/harnesses";
import type {
  AgentPort,
  AgentRunQuery,
  AgentRunResult,
  AgentRunUsage,
  AgentStartSpec,
  AgentStarted,
  AgentStreamOutcome,
} from "./types/agentPort";
import type { AgentCall, FakeAgentIdentity } from "./types/fakeAgentPort";

/**
 * The in-memory scripted agent port (design §7 dry-run, task 27 — the test
 * harness fake promoted into `lib/`): every `start()` returns a durable-looking
 * handle; `stream()`/`getRun()` pop the next scripted outcome in call order
 * (the last one repeats, mirroring the repo's stub-port convention), and every
 * start/follow-up/cancel is recorded so callers assert at the port boundary.
 *
 * The dry-run harness registers the default identity — a `dry-run` execution
 * mode flow resolves this port through `forMode("dry-run")`, so its side
 * effects (agent runs) are simulated while the graph, contracts and effects
 * run for real. An empty scripted queue fails loudly: the harness replays
 * scripted results, it never fabricates an output.
 *
 * Must never: touch a real agent runtime, persist anything, or guess an
 * unscripted outcome — a dry run without a scripted result is a loud failure,
 * not a fabricated success.
 */
export class FakeAgentPort implements AgentPort {
  readonly kind: string;
  readonly label: string;
  readonly execMode: RunMode;
  readonly harness: string;
  readonly fallbackModels = [] as const;
  readonly listDiscount = 0;

  readonly calls: AgentCall[] = [];
  /** When true, every getRun() answers {state:"running"} (mid-wait probes). */
  runningForever = false;

  private readonly outcomes: AgentRunResult[] = [];
  private counter = 0;
  private readonly cancelled = new Set<string>();

  constructor(
    identity: FakeAgentIdentity = {
      kind: HARNESS_KEYS.DRY_RUN,
      harness: HARNESS_KEYS.DRY_RUN,
      execMode: RUN_MODE.DRY_RUN,
    },
  ) {
    this.kind = identity.kind;
    this.label = identity.label ?? "Dry-run agent";
    this.execMode = identity.execMode;
    this.harness = identity.harness;
  }

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
        "dry-run harness: no scripted agent outcome for this run — the simulation replays scripted results only",
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
