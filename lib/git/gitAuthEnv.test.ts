import { describe, expect, it } from "vitest";

import { gitLabOAuthBasicHeaderEnv } from "./gitAuthEnv";

describe("gitLabOAuthBasicHeaderEnv", () => {
  it("sets GIT_CONFIG http.extraHeader with Basic oauth2 credentials", () => {
    const env = gitLabOAuthBasicHeaderEnv("pat-token");
    expect(env.GIT_CONFIG_COUNT).toBe("1");
    expect(env.GIT_CONFIG_KEY_0).toBe("http.extraHeader");
    expect(env.GIT_CONFIG_VALUE_0).toMatch(/^Authorization: Basic /);
    expect(env.GIT_CONFIG_VALUE_0).not.toContain("pat-token");
  });
});
