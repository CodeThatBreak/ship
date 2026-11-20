import "server-only";

import { PromptPreview } from "./promptPreview/promptPreview";

/**
 * Process pin for the prompt modal's truth layer (decision Q9). The
 * PromptPreview class lives in `promptPreview/`; this module keeps the pin
 * so the import surface (`promptPreview`) is unchanged. Stateless (all
 * truth in Postgres) — class files are pure (classFilePurity arch test),
 * so the instance is pinned here.
 */
export const promptPreview = new PromptPreview();
