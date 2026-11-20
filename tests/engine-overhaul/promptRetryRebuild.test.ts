/**
 * Step 05 retry coherence: a non-plan node retry REBUILDS its prompt from the
 * current template + recorded vars instead of replaying the recorded
 * `input.prompt` verbatim. The strip is what the retry path does before
 * `def.run(...)`; the run paths of build/review/resolve/pipeline then fall
 * back to `prompts.resolve`/`assemblePrompt` (their pre-existing behavior
 * when `input.prompt` is empty). Declarative agent/http/script retries keep
 * replaying their recorded prompt; plan retries route through the chat-first
 * branch.
 */
import { describe, expect, it } from "vitest";

const { flowEngine } = await import("../../lib/engine/flowEngine");

/** The strip step — the retry service owns it (step 07 moved it off the facade). */
const rebuild = (def: { key: string }, recorded: Record<string, unknown>): unknown =>
  flowEngine.retries.rebuildRetryInput(def as unknown as Parameters<typeof flowEngine.retries.rebuildRetryInput>[0], recorded);

describe("retryNode prompt rebuild (step 05)", () => {
  it("strips the recorded prompt keys for the built-in agent kinds", () => {
    const recorded = {
      prompt: "the frozen final prompt from the failed run",
      promptIsBody: true,
      prompt_source: "modal",
      instructions: "focus on error handling",
      model: "gpt-x",
    };
    for (const key of ["build", "step_build", "review", "resolve", "pipeline"]) {
      expect(rebuild({ key }, recorded)).toEqual({
        instructions: "focus on error handling",
        model: "gpt-x",
      });
    }
  });

  it("leaves the recorded input untouched for every other kind", () => {
    const recorded = {
      prompt: "the frozen final prompt from the failed run",
      promptIsBody: false,
      prompt_source: "config",
      model: null,
    };
    // plan routes through the chat-first branch before this runs, and a
    // declarative agent template key keeps its recorded-prompt replay
    for (const key of ["plan", "topic_agent_fixture"]) {
      expect(rebuild({ key }, recorded)).toEqual(recorded);
    }
  });
});
