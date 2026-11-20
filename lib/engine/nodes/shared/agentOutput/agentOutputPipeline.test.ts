/**
 * The ONE agent-output pipeline (step 05, Invariant 6): contract validation →
 * bounded feedback retry → typed events. The events are the contract here —
 * a first-pass success stays silent, a retryable miss emits exactly one
 * `output_retry` per spent attempt, an exhausted budget emits
 * `output_exhausted` before the throw, and the agent's own error envelope is
 * `agent_reported` + immediate throw (never fed back for another attempt).
 *
 * Pure unit tests: the pipeline only needs a stub support whose `emit`
 * journals calls — no database is touched. The kind-facing request shape
 * mirrors how plan/resolve/agent/decision call it.
 */
import { describe, expect, it } from "vitest";

import { AgentOutputPipeline } from "./agentOutputPipeline";
import {
  AGENT_OUTPUT_ERROR,
  AgentOutputError,
} from "../agent/outputError/outputErrorExports";
import { RunSupersededError } from "../../../errors/runSupersededError";
import type { AgentOutputRequest } from "./types/agentOutput";
import type { NodeSupport } from "../nodeSupport";
import type { FlowCtx } from "../nodeSharedExports";

/** One journaled pipeline event: the typed kind + message + structured data. */
interface EmittedEvent {
  readonly kind: string;
  readonly message: string;
  readonly data: Record<string, unknown>;
}

/** A stub support whose only exercised method — `emit` — journals calls. */
const journalingSupport = (events: EmittedEvent[]): NodeSupport =>
  ({
    emit: async (
      _flowId: string,
      _nodeId: string,
      kind: string,
      message: string,
      data?: Record<string, unknown>,
    ) => {
      events.push({ kind, message, data: data ?? {} });
    },
  }) as unknown as NodeSupport;

const ctx = { flow: { id: "flow-1" } } as unknown as FlowCtx;

/** A no_json miss the way kinds build it (the standard error, no factories). */
const noJsonError = (): AgentOutputError =>
  new AgentOutputError({
    code: AGENT_OUTPUT_ERROR.NO_JSON,
    label: "decision",
    message: "decision: no JSON object could be parsed from the response",
    issues: [{ path: "", message: "no JSON object could be parsed" }],
    response: "prose, not json",
  });

/** A `schema_mismatch` miss with one issue, for a multi-attempt budget test. */
const schemaMismatchError = (): AgentOutputError =>
  new AgentOutputError({
    code: AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
    label: "decision",
    message: "decision: the response violated the output schema",
    issues: [{ path: "choice", message: "required" }],
    response: '{"wrong": true}',
  });

/** The agent's escape hatch: the standard error envelope as a typed throw. */
const agentReportedError = (): AgentOutputError =>
  new AgentOutputError({
    code: AGENT_OUTPUT_ERROR.AGENT_REPORTED,
    label: "decision",
    message: "decision: the agent could not satisfy the contract",
    issues: [],
    response: '{"output_error": {"reason": "the task input is missing"}}',
    reported: { reason: "the task input is missing" },
  });

interface RequestOverrides {
  readonly text?: string;
  readonly budget?: number;
  readonly validate?: (text: string) => string;
  readonly retryPrompt?: (failure: AgentOutputError, attempt: number) => string;
  readonly executeRetry?: (retryPrompt: string, attempt: number) => Promise<string>;
}

/** A request in the shape the kinds submit; every collaborator is overridable
 *  and journals nothing itself — the events under test come from the pipeline. */
const request = (events: EmittedEvent[], overrides: RequestOverrides = {}): AgentOutputRequest<string> => ({
  ctx,
  nodeId: "node-1",
  label: "decision",
  text: "first response",
  budget: 1,
  validate: () => "first-pass value",
  retryPrompt: (failure: AgentOutputError, attempt: number) => `retry prompt ${attempt} (${failure.code})`,
  executeRetry: async () => "retry value",
  ...overrides,
});

/** Journals the retry collaborators' calls so tests assert the feedback loop. */
const recordingRetries = (): {
  readonly calls: {
    readonly prompts: readonly { readonly failureCode: string; readonly attempt: number }[];
    readonly executed: readonly { readonly prompt: string; readonly attempt: number }[];
  };
  readonly overrides: Pick<RequestOverrides, "retryPrompt" | "executeRetry">;
} => {
  const prompts: { failureCode: string; attempt: number }[] = [];
  const executed: { prompt: string; attempt: number }[] = [];
  return {
    calls: { prompts, executed },
    overrides: {
      retryPrompt: (failure: AgentOutputError, attempt: number) => {
        prompts.push({ failureCode: failure.code, attempt });
        return `retry prompt ${attempt}`;
      },
      executeRetry: async (prompt: string, attempt: number) => {
        executed.push({ prompt, attempt });
        return `retry value ${attempt}`;
      },
    },
  };
};

describe("AgentOutputPipeline — the one agent-output pipeline (Invariant 6)", () => {
  it("a first-pass valid response emits NO events and returns the validated value", async () => {
    const events: EmittedEvent[] = [];
    const retries = recordingRetries();

    const value = await new AgentOutputPipeline(journalingSupport(events)).run(
      request(events, retries.overrides),
    );

    expect(value).toBe("first-pass value");
    expect(events).toEqual([]);
    expect(retries.calls.prompts).toEqual([]);
    expect(retries.calls.executed).toEqual([]);
  });

  it("a retryable miss retries ONCE with feedback: one typed output_retry event, the retry's value returned", async () => {
    const events: EmittedEvent[] = [];
    const retries = recordingRetries();
    let call = 0;
    const value = await new AgentOutputPipeline(journalingSupport(events)).run(
      request(events, {
        ...retries.overrides,
        validate: (text: string) => {
          call += 1;
          if (call === 1) throw noJsonError();
          expect(text).toBe("retry value 1");
          return "recovered value";
        },
      }),
    );

    expect(value).toBe("recovered value");
    expect(events.length).toBe(1);
    const [retry] = events;
    // the typed kind, asserted as the literal the activity feed keys on
    expect(retry?.kind).toBe("output_retry");
    expect(retry?.message).toContain("output contract failed");
    expect(retry?.data).toEqual({
      code: "no_json",
      attempt: 1,
      budget: 1,
      issues: [{ path: "", message: "no JSON object could be parsed" }],
    });
    // the feedback loop: one retry prompt built from the failure, one turn
    expect(retries.calls.prompts).toEqual([{ failureCode: "no_json", attempt: 1 }]);
    expect(retries.calls.executed).toEqual([{ prompt: "retry prompt 1", attempt: 1 }]);
  });

  it("an exhausted budget emits output_retry then output_exhausted and throws the AgentOutputError (code survives)", async () => {
    const events: EmittedEvent[] = [];
    const retries = recordingRetries();

    const thrown = await new AgentOutputPipeline(journalingSupport(events))
      .run(request(events, { ...retries.overrides, validate: () => { throw noJsonError(); } }))
      .catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(AgentOutputError);
    const error = thrown as AgentOutputError;
    expect(error.code).toBe("no_json");
    expect(events.map((e) => e.kind)).toEqual(["output_retry", "output_exhausted"]);
    expect(events[0]?.data).toMatchObject({ code: "no_json", attempt: 1, budget: 1 });
    const exhausted = events[1] as EmittedEvent;
    expect(exhausted.kind).toBe("output_exhausted");
    expect(exhausted.message).toContain("still violated after 1 feedback retry(ies)");
    expect(exhausted.data).toEqual({
      code: "no_json",
      budget: 1,
      issues: [{ path: "", message: "no JSON object could be parsed" }],
    });
    // the budget was spent on exactly one feedback turn
    expect(retries.calls.executed.length).toBe(1);
  });

  it("an agent-reported envelope emits the typed agent_reported event and throws immediately — never retried", async () => {
    const events: EmittedEvent[] = [];
    const retries = recordingRetries();

    const thrown = await new AgentOutputPipeline(journalingSupport(events))
      .run(request(events, { ...retries.overrides, validate: () => { throw agentReportedError(); } }))
      .catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(AgentOutputError);
    expect((thrown as AgentOutputError).code).toBe("agent_reported");
    expect(events.length).toBe(1);
    const [reported] = events;
    expect(reported?.kind).toBe("agent_reported");
    expect(reported?.data).toEqual({ code: "agent_reported", reason: "the task input is missing" });
    // the agent's reason goes to the user, never back for another attempt —
    // even with the full budget unspent
    expect(retries.calls.prompts).toEqual([]);
    expect(retries.calls.executed).toEqual([]);
  });

  it("the budget is per-request configurable: budget 2 spends TWO retries before exhaustion", async () => {
    const events: EmittedEvent[] = [];
    const retries = recordingRetries();
    let call = 0;

    const thrown = await new AgentOutputPipeline(journalingSupport(events))
      .run(request(events, {
        ...retries.overrides,
        budget: 2,
        validate: () => {
          call += 1;
          // a different retryable miss per attempt — the payload carries each
          throw call === 1 ? noJsonError() : schemaMismatchError();
        },
      }))
      .catch((e: unknown) => e);

    expect((thrown as AgentOutputError).code).toBe("schema_mismatch");
    expect(events.map((e) => e.kind)).toEqual(["output_retry", "output_retry", "output_exhausted"]);
    expect(events[0]?.data).toMatchObject({ code: "no_json", attempt: 1, budget: 2 });
    expect(events[1]?.data).toMatchObject({ code: "schema_mismatch", attempt: 2, budget: 2 });
    expect(events[2]?.data).toMatchObject({ code: "schema_mismatch", budget: 2 });
    expect(retries.calls.executed.map((c) => c.attempt)).toEqual([1, 2]);
  });

  it("a non-AgentOutputError throw from validate propagates untouched (no events, no retry)", async () => {
    const events: EmittedEvent[] = [];
    const superseded = new RunSupersededError("node-1", "running", "run-1");

    const thrown = await new AgentOutputPipeline(journalingSupport(events))
      .run(request(events, { validate: () => { throw superseded; } }))
      .catch((e: unknown) => e);

    expect(thrown).toBe(superseded);
    expect(events).toEqual([]);
  });

  it("a non-AgentOutputError throw from executeRetry propagates untouched (past the retry event)", async () => {
    const events: EmittedEvent[] = [];
    const superseded = new RunSupersededError("node-1", "running", "run-1");

    const thrown = await new AgentOutputPipeline(journalingSupport(events))
      .run(request(events, {
        validate: () => { throw noJsonError(); },
        executeRetry: async () => { throw superseded; },
      }))
      .catch((e: unknown) => e);

    expect(thrown).toBe(superseded);
    // the retry was announced before the turn executed — the turn's own throw
    // (not an output-contract miss) is the kind's execution path's business
    expect(events.map((e) => e.kind)).toEqual(["output_retry"]);
  });
});
