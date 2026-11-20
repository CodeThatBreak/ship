import "server-only";

import { MergeRequestService } from "./mergeRequestService/mergeRequestService";

/**
 * Shared merge-request service (decision Q9 — plain module const): the MR
 * paths are DB/host-fenced, so per-module-graph copies cannot disagree (the
 * `engineParts` precedent). The MergeRequestService class lives in
 * `mergeRequestService/mergeRequestService.ts` — class files are pure
 * (classFilePurity arch test); this module keeps the pin so the import
 * surface is unchanged.
 */
export const mergeRequests = new MergeRequestService();
