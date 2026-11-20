import "server-only";

import { NodeRegistry } from "./registry/nodeRegistry";

/**
 * The single source of truth for the workflow graph (built-ins registered in
 * the NodeRegistry constructor; declarative kinds resolve through the wired
 * resolver — `declarativeBootstrap.ts`). The NodeRegistry class lives in
 * `registry/nodeRegistry.ts` — class files are pure (classFilePurity arch
 * test); this module keeps the pin so the import surface is unchanged.
 */
export const nodeRegistry = new NodeRegistry();
