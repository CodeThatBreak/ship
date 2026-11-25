import "server-only";

/**
 * Variables a spawned child must never inherit from the DevFlow host process.
 *
 * The host is a Next.js server, and Next pins `NODE_ENV=production` for its own
 * whole process (`node_modules/next/dist/bin/next`: `process.env.NODE_ENV =
 * process.env.NODE_ENV || defaultEnv`). Everything DevFlow spawns — git hooks,
 * dependency installs, agent shells — then believes it is running in CI or in
 * production, which is false: those children are acting on a developer's
 * checkout.
 *
 * Two concrete failures this prevents:
 * - `yarn validate`-style hooks branch on `NODE_ENV=production` into their CI
 *   path, look for a CI-only diff base, find no files to check, and exit 0 —
 *   a lint gate that silently passes everything.
 * - `npm ci` / `npm install` under `NODE_ENV=production` run with
 *   `--omit=dev`, so a worktree gets no devDependencies at all (no husky, no
 *   prettier, no test runner).
 *
 * Keep this list minimal and justified. A child that genuinely needs a
 * production marker must set it explicitly at its own call site.
 */
export const CHILD_ENV_EXCLUSIONS = ["NODE_ENV"] as const;

/**
 * The environment for a subprocess DevFlow spawns on a developer's behalf:
 * the host's env minus {@link CHILD_ENV_EXCLUSIONS}, with `overrides` merged on
 * top (an explicit override always wins — call sites that truly need a value
 * set it themselves).
 *
 * Typed as `NodeJS.ProcessEnv` because that is what `spawn`/`execFile` accept,
 * even though `NODE_ENV` is deliberately absent: Next's global augmentation
 * declares it required (`node_modules/next/types/global.d.ts`), and that
 * required-ness is exactly the assumption this helper exists to break.
 */
export const childProcessEnv = (
  overrides: Record<string, string> = {},
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if ((CHILD_ENV_EXCLUSIONS as readonly string[]).includes(key)) continue;
    env[key] = value;
  }
  return { ...env, ...overrides } as NodeJS.ProcessEnv;
};
