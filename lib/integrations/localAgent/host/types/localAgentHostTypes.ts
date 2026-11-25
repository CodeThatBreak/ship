import "server-only";

import type { ModelSelection } from "@cursor/sdk";
import type { SDKSettingSource } from "../../../cursorSdk";

/** One local agent run, as `LocalAgentService` hands it to the host child. */
export interface LocalAgentHostRunInput {
  prompt: string;
  cwd: string;
  mode?: "agent" | "plan";
  name?: string;
  /** already fast-pinned by the parent (`CursorAgentService.resolveModel`) */
  model?: ModelSelection;
  sandbox: boolean;
  force: boolean;
  /** resume an existing agent conversation (follow-up) */
  resumeAgentId?: string;
  /** ambient Cursor settings layers (their MCP servers) the agent loads */
  settingSources?: SDKSettingSource[];
  /**
   * The run's own env vars (`AgentStartSpec.env` — declared secrets and the
   * agent-tools capability token). Merged over the scrubbed server env.
   */
  env?: Record<string, string>;
  /** the resolved Cursor API key — rides IPC, never the environment */
  apiKey: string;
}

/** Construction knobs of `LocalAgentHost` — injectable so tests can point the
 *  fork at a fixture child; the pinned instance uses the defaults. */
export interface LocalAgentHostOptions {
  /** the child entry module forked per run */
  childModulePath: string;
  /** the tsconfig tsx resolves the child's path aliases with (incl. the
   *  `server-only` stub) */
  tsconfigPath: string;
  /** how long cancelRun waits for a graceful child exit before SIGTERM */
  killGraceMs: number;
}
