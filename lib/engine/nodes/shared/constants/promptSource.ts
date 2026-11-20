import "server-only";

/** Where a recorded run's prompt came from. */
export const PROMPT_SOURCE = {
  MODAL: "modal",
  CONFIG: "config",
  DEFAULT: "default",
} as const;
export type PromptSource = (typeof PROMPT_SOURCE)[keyof typeof PROMPT_SOURCE];
export const PROMPT_SOURCES: readonly PromptSource[] = Object.values(PROMPT_SOURCE);
