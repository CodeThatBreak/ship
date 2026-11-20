import "server-only";

import { HOOK_PATTERNS } from "../constants/hookPatterns";

/**
 * True when a push failure looks like a code/hook rejection rather than infra
 * (merge-request errors owns the signatures; the merge arena's Phase-2
 * classification reuses them verbatim so "repairable code state vs infra
 * failure" is decided the same way in both paths).
 */
export const isHookRejection = (text: string): boolean =>
  HOOK_PATTERNS.some((p) => p.test(text));
