import "server-only";

import { MrTargetResolver } from "./mrTargetResolver/mrTargetResolver";

/**
 * Shared MR target resolver (decision Q9 — plain module const, stateless over
 * injected services): the MrTargetResolver class lives in
 * `mrTargetResolver/mrTargetResolver.ts` — class files are pure
 * (classFilePurity arch test); this module keeps the pin so the import
 * surface is unchanged.
 */
export const mrTargetResolver = new MrTargetResolver();
