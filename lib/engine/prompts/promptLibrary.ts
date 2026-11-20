import "server-only";

import { PromptLibrary } from "./promptLibrary/promptLibrary";

/**
 * Process pin for the prompt library (decision Q9). The PromptLibrary class
 * lives in `promptLibrary/`; this module keeps the pin so the import surface
 * (`prompts`) is unchanged. Stateless (all truth in the template defaults +
 * registry) — class files are pure (classFilePurity arch test), so the
 * instance is pinned here.
 */
export const prompts = new PromptLibrary();
