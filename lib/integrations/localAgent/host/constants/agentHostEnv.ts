import "server-only";

/**
 * Server env keys that must NEVER reach a local agent host child process
 * (and through it, the agent's shells and git hooks) — see
 * docs/local-agents-in-worker-plan.md.
 *
 * Maintenance invariant: every secret/config variable `lib/config.ts` reads
 * from the environment belongs on this list. When you add an env read to
 * `lib/config.ts`, add the key here or it silently leaks into every local
 * agent shell (the child inherits a scrubbed copy of the web process env).
 */
export const SCRUBBED_ENV_KEYS: readonly string[] = [
  // Next.js server markers — `NODE_ENV=production` under `npm run start` is
  // the husky bug: hooks keyed on NODE_ENV skip their dev behavior and
  // `yarn install` skips devDependencies.
  "NODE_ENV",
  "NEXT_RUNTIME",
  "NEXT_PHASE",
  // DevFlow server secrets (lib/config.ts reads these from `.env`)
  "DEVFLOW_LOCAL_API_TOKEN",
  "DEVFLOW_SECRETS_KEY",
  "DATABASE_URL",
  "TEST_DATABASE_URL",
  "GITLAB_WEBHOOK_SECRET",
  "GITLAB_WEBHOOK_ALLOW_UNSIGNED",
  // the Cursor API key rides the IPC `start` message, never the environment
  "CURSOR_API_KEY",
];

/** Env key prefixes scrubbed with their whole family (Next.js internals). */
export const SCRUBBED_ENV_PREFIXES: readonly string[] = ["__NEXT", "NEXT_PRIVATE_"];
