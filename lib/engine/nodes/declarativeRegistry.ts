import "server-only";

import { pinnedProcessService } from "../../composition/processServices";
import { DeclarativeKindRegistry } from "./declarativeRegistry/declarativeKindRegistry";
import { DeclarativeDefCache } from "./declarativeRegistry/declarativeDefCache";

/** Declarative row/type shapes live beside the classes (`declarativeRegistry/types`). */
export type { DeclarativeRow } from "./declarativeRegistry/types/declarativeRow";

/** Shared declarative kind registry (decision Q9, plain module const): the
 *  registrations are static side-effect imports (`declarativeWiring.ts`) —
 *  every module-graph copy registers the same entries, so copies cannot
 *  disagree. The DeclarativeKindRegistry class lives in
 *  `declarativeRegistry/declarativeKindRegistry.ts` — class files are pure
 *  (classFilePurity arch test); this module keeps the pin so the import
 *  surface is unchanged. */
export const declarativeKindRegistry = new DeclarativeKindRegistry();

/**
 * Shared declarative def cache. Process-pinned via the process-services
 * container (decision Q9): it caches DB-row-hydrated defs WITHOUT a TTL and
 * relies on explicit `invalidate()` on template edit — per-module-graph
 * copies would serve a stale def from another bundle after an edit instead
 * of re-reading the row. The DeclarativeDefCache class lives in
 * `declarativeRegistry/declarativeDefCache.ts`.
 */
export const declarativeDefCache = pinnedProcessService(
  "declarativeDefCache",
  () => new DeclarativeDefCache(),
);
