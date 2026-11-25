import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Test database config comes from the repo `.env` (TEST_DATABASE_URL /
 * DATABASE_URL). Vitest does not populate `process.env` from `.env` on its
 * own, so load it here — this runs in the main process and in every worker,
 * keeping `tests/globalSetup.ts` on the same Postgres instance (and port) the
 * app and the Prisma CLI use.
 */
const repoRoot = fileURLToPath(new URL(".", import.meta.url));
const envFile = new URL("./.env", import.meta.url);
if (fs.existsSync(envFile)) process.loadEnvFile(fileURLToPath(envFile));

/**
 * Unit tests for lib/ (server-only modules). "server-only" throws outside a
 * React server bundle, so it is aliased to an empty stub under vitest.
 */
export default defineConfig({
  root: repoRoot,
  // component tests import .tsx panels; tsconfig's `jsx: preserve` otherwise
  // leaves JSX in the source and Vite's import analysis rejects it
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)),
      // mirror tsconfig's `@/*` → `./*`
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "tests/**/*.test.ts"],
    globalSetup: [fileURLToPath(new URL("./tests/globalSetup.ts", import.meta.url))],
    // DB-touching tests share the dockerized test database — serial files keep
    // per-file truncation + template seeding race-free (`fileParallelism:
    // false` forces maxWorkers = 1 in vitest v5).
    fileParallelism: false,
  },
});
