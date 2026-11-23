import "server-only";

import { FlowEngine } from "./flowEngine/flowEngine";

/** Shared flow engine (decision Q9 — plain module const): composition + delegation only; every collaborator is stateless or DB-fenced, so per-module-graph copies cannot disagree (the `engineParts` precedent). The FlowEngine class lives in `flowEngine/flowEngine.ts` — class files are pure (classFilePurity arch test); this module keeps the pin so the import surface is unchanged. */
export const flowEngine = new FlowEngine();
