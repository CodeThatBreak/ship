import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAgentHostEnv } from "./agentHostEnv";
import { SCRUBBED_ENV_KEYS } from "./constants/agentHostEnv";

describe("buildAgentHostEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("strips the scrubbed keys and Next.js prefixes from the base env", () => {
    const base = {
      NODE_ENV: "production",
      NEXT_RUNTIME: "nodejs",
      NEXT_PHASE: "phase-production-build",
      __NEXT_PRIVATE_PREBUNDLED_REACT: "experimental",
      NEXT_PRIVATE_QUIET: "1",
      DEVFLOW_LOCAL_API_TOKEN: "server-token",
      DEVFLOW_SECRETS_KEY: "server-key",
      DATABASE_URL: "postgres://server",
      TEST_DATABASE_URL: "postgres://test",
      GITLAB_WEBHOOK_SECRET: "hook-secret",
      GITLAB_WEBHOOK_ALLOW_UNSIGNED: "1",
      CURSOR_API_KEY: "cursor-key",
      PATH: "/usr/bin",
      HOME: "/home/dev",
    };
    const out = buildAgentHostEnv(base);
    for (const key of SCRUBBED_ENV_KEYS) {
      expect(out[key]).toBeUndefined();
    }
    expect(out).not.toHaveProperty("NODE_ENV");
    expect(out).not.toHaveProperty("NEXT_RUNTIME");
    expect(out).not.toHaveProperty("NEXT_PHASE");
    expect(out).not.toHaveProperty("__NEXT_PRIVATE_PREBUNDLED_REACT");
    expect(out).not.toHaveProperty("NEXT_PRIVATE_QUIET");
    expect(out.PATH).toBe("/usr/bin");
    expect(out.HOME).toBe("/home/dev");
  });

  it("merges the run env on top and lets the run env win over base", () => {
    const out = buildAgentHostEnv({ PATH: "/usr/bin", MY_TOOL_URL: "https://server" }, {
      MY_TOOL_URL: "https://run",
      DEVFLOW_AGENT_TOKEN: "run-token",
    });
    expect(out.MY_TOOL_URL).toBe("https://run");
    expect(out.DEVFLOW_AGENT_TOKEN).toBe("run-token");
    expect(out.PATH).toBe("/usr/bin");
  });

  it("does not mutate the base env", () => {
    const base = { NODE_ENV: "production", KEEP: "1" };
    buildAgentHostEnv(base, { DEVFLOW_AGENT_TOKEN: "run-token" });
    expect(base).toEqual({ NODE_ENV: "production", KEEP: "1" });
  });

  it("drops undefined values from the base env", () => {
    const out = buildAgentHostEnv({ KEEP: "1", UNSET: undefined });
    expect(out).toEqual({ KEEP: "1" });
  });

  it("fails loudly when a run-env key collides with the scrub list (e.g. a declared secret named NODE_ENV)", () => {
    expect(() => buildAgentHostEnv({}, { NODE_ENV: "development" })).toThrow(/protected server variable: NODE_ENV/);
    expect(() => buildAgentHostEnv({}, { DEVFLOW_SECRETS_KEY: "nope" })).toThrow(
      /protected server variable: DEVFLOW_SECRETS_KEY/,
    );
    expect(() => buildAgentHostEnv({}, { NEXT_PRIVATE_LEAK: "nope" })).toThrow(/protected server variable/);
    expect(() => buildAgentHostEnv({}, { DEVFLOW_AGENT_TOKEN: "fine" })).not.toThrow();
  });

  it("keeps the scrub effective against the base even under a production-style env (the husky bug)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEVFLOW_SECRETS_KEY", "server-key");
    vi.stubEnv("DEVFLOW_AGENT_TOKEN", "run-token");
    const out = buildAgentHostEnv(process.env);
    expect(out.NODE_ENV).toBeUndefined();
    expect(out.DEVFLOW_SECRETS_KEY).toBeUndefined();
    expect(out.DEVFLOW_AGENT_TOKEN).toBe("run-token");
  });
});
