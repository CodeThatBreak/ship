/**
 * The local agent host child process — the target `LocalAgentHost` forks once
 * per local agent run (docs/local-agents-in-worker-plan.md). The parent (web
 * or worker process — whichever executes the node) builds a scrubbed env plus
 * the run's own env vars, so the agent's shells and git hooks inherit neither
 * the DevFlow server's NODE_ENV nor its secrets. The run loop itself lives in
 * `lib/integrations/localAgent/host/agentHostChild.ts`; this file only wires
 * the real process IPC and SDK onto its injected seams.
 */
import { Agent } from "@cursor/sdk";
import { runAgentHostChild } from "@/lib/integrations/localAgent/host/agentHostChild";
import type { AgentHostChildMessage } from "@/lib/integrations/localAgent/host/types/agentHostProtocol";

// tsx read TSX_TSCONFIG_PATH when the `--import tsx` loader registered —
// before this module ran. Delete it so the loader-only variable can't leak
// into the agent's shells.
delete process.env.TSX_TSCONFIG_PATH;

runAgentHostChild(
  {
    post: (message: AgentHostChildMessage) => {
      try {
        process.send?.(message);
      } catch {
        // channel already closed — the disconnect handler exits the child
      }
    },
    onParentMessage: (handler) => process.on("message", (raw: unknown) => handler(raw)),
    onDisconnect: (handler) => process.on("disconnect", handler),
    exit: (code) => process.exit(code),
  },
  {
    create: (opts) => Agent.create(opts),
    resume: (agentId, opts) => Agent.resume(agentId, opts),
  },
);
