import "server-only";

import { TemplatePreviewService } from "./templatePreviewService/templatePreviewService";

/**
 * Process pin for the template preview service (decision Q9). The
 * TemplatePreviewService class lives in `templatePreviewService/`; this
 * module keeps the pin so the import surface (`templatePreviewService`)
 * is unchanged. Stateless (all truth in Postgres) — class files are pure
 * (classFilePurity arch test), so the instance is pinned here.
 */
export const templatePreviewService = new TemplatePreviewService();
