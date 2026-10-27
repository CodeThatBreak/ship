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
  },
});
