import { describe, expect, it } from "vitest";

/**
 * The local-agent host must satisfy two properties at once, and they pull in
 * opposite directions:
 *
 *  1. Shells spawned by the SDK see NO `NODE_ENV` (that marker is what made
 *     repo hooks take their CI branch and check nothing).
 *  2. `lib/config.ts` still resolves what the web process resolved — the
 *     database URL and at-rest key both branch on `NODE_ENV`, so a host that
 *     boots in a different mode would attach to a DIFFERENT database.
 *
 * The host achieves that by pinning the NODE_ENV-derived decisions before
 * dropping the marker. These tests exercise the ordering directly, since an
 * integration test would need a live Cursor run.
 */
const pinResolvedConfig = (env: NodeJS.ProcessEnv, resolveDbUrl: () => string): void => {
  if (!env.DATABASE_URL) env.DATABASE_URL = resolveDbUrl();
  // mirrors the host: Next's augmentation marks NODE_ENV readonly
  Reflect.deleteProperty(env, "NODE_ENV");
};

describe("local agent host env ordering", () => {
  it("keeps the NODE_ENV-derived database URL after the marker is removed", () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
    // stands in for `config.db.url()`: an explicit DATABASE_URL wins, then the
    // production branch (devflow_prod), then the dev default
    const resolveDbUrl = () => {
      if (env.DATABASE_URL) return env.DATABASE_URL;
      return env.NODE_ENV === "production"
        ? "postgresql://devflow:devflow@localhost:5432/devflow_prod"
        : "postgresql://devflow:devflow@localhost:5432/devflow";
    };

    pinResolvedConfig(env, resolveDbUrl);

    expect(env.DATABASE_URL).toBe("postgresql://devflow:devflow@localhost:5432/devflow_prod");
    // the resolution still agrees with the server AFTER the strip
    expect(resolveDbUrl()).toBe("postgresql://devflow:devflow@localhost:5432/devflow_prod");
  });

  it("removes NODE_ENV so agent shells do not inherit it", () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: "production", PATH: "/usr/bin" };

    pinResolvedConfig(env, () => "postgresql://devflow:devflow@localhost:5432/devflow_prod");

    expect(env.NODE_ENV).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
  });

  it("never overrides a DATABASE_URL the deployment provided", () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://configured/elsewhere",
    };

    pinResolvedConfig(env, () => "postgresql://devflow:devflow@localhost:5432/devflow_prod");

    expect(env.DATABASE_URL).toBe("postgresql://configured/elsewhere");
  });
});
