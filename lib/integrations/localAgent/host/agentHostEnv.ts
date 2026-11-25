import "server-only";

import { ValidationError } from "../../../errors";
import { SCRUBBED_ENV_KEYS, SCRUBBED_ENV_PREFIXES } from "./constants/agentHostEnv";

const isScrubbedEnvKey = (key: string): boolean =>
  SCRUBBED_ENV_KEYS.includes(key) || SCRUBBED_ENV_PREFIXES.some((p) => key.startsWith(p));

/**
 * Build the environment a local agent host child process is forked with
 * (docs/local-agents-in-worker-plan.md): a copy of the base (server) env
 * with the scrubbed keys/prefixes removed, plus the run's own env vars
 * (`AgentStartSpec.env` — declared secrets and the agent-tools capability
 * token) merged on top.
 *
 * Order matters: the scrub is applied AFTER the merge, so a server var
 * cannot come back through the run env. A run-env key that collides with
 * the scrub list is a config error and fails loudly (a declared secret named
 * `NODE_ENV` must not silently re-inject the variable the scrub just
 * removed, nor shadow `DEVFLOW_AGENT_TOKEN`).
 *
 * Pure: `base` is never mutated; the returned object is a fresh copy.
 */
export const buildAgentHostEnv = (
  base: Record<string, string | undefined>,
  runEnv?: Record<string, string>,
): Record<string, string> => {
  const colliding = runEnv ? Object.keys(runEnv).filter(isScrubbedEnvKey) : [];
  if (colliding.length > 0) {
    throw new ValidationError(
      `Local run env declares a protected server variable: ${colliding.join(", ")} — rename the secret/env var`,
    );
  }

  const merged: Record<string, string | undefined> = { ...base, ...runEnv };
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) continue;
    if (isScrubbedEnvKey(key)) continue;
    out[key] = value;
  }
  return out;
};
