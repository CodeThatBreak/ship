/**
 * Load `.env` into `process.env` — imported FIRST by `worker/main.ts`.
 *
 * ESM evaluates every imported module before the importing module's own body
 * runs, so a `loadEnvConfig(...)` call placed above the other imports in
 * `main.ts` would still execute too late: `@/lib/config` (and with it the
 * Prisma client) would already have captured an unset `DATABASE_URL` and
 * silently fallen back to the built-in default database. Keeping the load in
 * its own module, imported before anything that reads the environment, is what
 * makes the ordering guaranteed rather than incidental.
 */
import { loadEnvConfig } from "@next/env";
import path from "node:path";

// `false` = production-style env files (.env.production, .env); the worker is
// infra and takes whatever DATABASE_URL the deployment provides.
loadEnvConfig(path.resolve(import.meta.dirname, ".."), false);
