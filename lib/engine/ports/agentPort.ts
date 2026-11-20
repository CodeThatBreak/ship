import "server-only";

import { AgentPortRegistry } from "./agentPort/agentPortRegistry";
import type { CatalogModel } from "../../modelSpec";
import type { SettingSource } from "../templates/schemas/mcpSources";

/**
 * Agent-runner port surface — the neutral surface engine + API code drives
 * agents through (cloud agent VMs, local in-process agent loops, future
 * vendors).
 *
 * Concrete runtimes implement `AgentPort` in `lib/integrations/<vendor>/` and
 * register themselves in `agentPortRegistry` (composition point — the one
 * place concrete integrations are named on the engine side). The engine
 * selects the port by the flow's execution mode ("cloud" | "local"),
 * preferring the port of the configured default harness when several ports
 * share that mode.
 *
 * The AgentPortRegistry class lives in `agentPort/` (its port types in
 * `agentPort/types/agentPort.ts`) — class files are pure (classFilePurity
 * arch test), so this module keeps the pin plus the surface's type
 * re-exports so every existing consumer keeps its import path.
 */
export const agentPortRegistry = new AgentPortRegistry();

export type { AgentRunLookupError, AgentRunTimeoutError, AgentRunWorkspaceError } from "./agentErrors";
export type { SettingSource };
export type { CatalogModel };
export type {
  AgentPort,
  AgentRunHandle,
  AgentRunQuery,
  AgentRunResult,
  AgentRunUsage,
  AgentStartSpec,
  AgentStarted,
  AgentStreamCallbacks,
  AgentStreamOutcome,
  PricingEntry,
} from "./agentPort/types/agentPort";
