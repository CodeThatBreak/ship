import "server-only";

import { TaskProviderRegistry } from "./registry/taskProviderRegistry";

/**
 * The single source of truth for task types — the registry pin. The
 * TaskProviderRegistry class lives in `registry/`; this module keeps the pin
 * so the import surface (`taskRegistry`) is unchanged. Class files are pure
 * (classFilePurity arch test), so the instance is pinned here.
 */
export const taskRegistry = new TaskProviderRegistry();
