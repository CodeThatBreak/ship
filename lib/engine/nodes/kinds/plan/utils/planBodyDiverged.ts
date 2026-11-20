import "server-only";

import { DEFAULT_PROMPT_TEMPLATES } from '../../../../prompts/promptDefaults';

/**
 * Whether a `promptIsBody` run body DIVERGES from the plan template's body
 * (§8 / §6c 'start' provenance): only a CLEARLY different body counts — the
 * comparison is the same normalization the assembly applies (trim + collapse
 * blank-line runs), so when in doubt the default is NO provenance (§6c).
 */
export const planBodyDiverged = (prompt: string | null | undefined): boolean => {
  if (!prompt?.trim()) return false;
  const norm = (s: string): string => s.trim().replace(/\n{3,}/g, '\n\n');
  return norm(prompt) !== norm(DEFAULT_PROMPT_TEMPLATES.plan.userTemplate);
};
