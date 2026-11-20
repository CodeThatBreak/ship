import "server-only";

import { NODE_KEYS } from "../../constants/nodeKeys";

/**
 * Built-in agent kinds whose retry REBUILDS the prompt from the current
 * template + recorded vars (step 05 retry coherence — the plan pattern):
 * their run input records the RENDERED final prompt, so replaying it verbatim
 * would pin the retry to the template as it stood when the run failed. The
 * recorded prompt keys are stripped and each def's run path re-resolves
 * (build/review/resolve/pipeline all fall back to `prompts.resolve`/
 * `assemblePrompt` when `input.prompt` is empty). Declarative agent/http/
 * script retries keep replaying their recorded prompt; plan retries route
 * through the chat-first branch in `FlowRetryService`.
 */
export const PROMPT_REBUILD_RETRY_KEYS: ReadonlySet<string> = new Set([
  NODE_KEYS.BUILD,
  NODE_KEYS.STEP_BUILD,
  NODE_KEYS.REVIEW,
  NODE_KEYS.RESOLVE,
  NODE_KEYS.PIPELINE,
]);

/** The engine-owned recorded-prompt keys a prompt-rebuilding retry strips. */
export const RECORDED_PROMPT_KEYS: readonly string[] = ["prompt", "promptIsBody", "prompt_source"];
