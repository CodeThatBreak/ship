import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit tests for lib/ (server-only modules). "server-only" throws outside a
 * React server bundle, so it is aliased to an empty stub under vitest.
 */
export default defineConfig({
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
