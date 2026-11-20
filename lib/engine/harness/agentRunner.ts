import "server-only";

import { config } from "../../config";
import { db } from "../../db/app";
import { agentPortRegistry } from "../ports/agentPort";
import { flowCtxHelper } from "../nodes/shared/runContext";
import { worktreeManager } from "../runtime/worktreeLifecycle";
import { nodeSupport } from "@/lib/composition/container";
import { usageTracker } from "./usageTracker";
import { AgentRunner } from "./agentRunner/agentRunner";

/**
 * Shared agent runner (decision Q9 — plain module const): run supervision is
 * stateless or DB-fenced, so per-module-graph copies cannot disagree (the
 * `engineParts` precedent). The AgentRunner class lives in
 * `agentRunner/agentRunner.ts` — class files are pure (classFilePurity arch
 * test); this module keeps the pin so the import surface is unchanged.
 */
export const agentRunner = new AgentRunner(
  flowCtxHelper,
  nodeSupport,
  usageTracker,
  db,
  config,
  agentPortRegistry,
  worktreeManager,
);
