import { describe, expect, it } from "vitest";

import { CHILD_ENV_EXCLUSIONS, childProcessEnv } from "./childProcessEnv";

const env = (base: Record<string, string | undefined>, overrides: Record<string, string> = {}) =>
  childProcessEnv(overrides, base as NodeJS.ProcessEnv);

describe("childProcessEnv", () => {
  it("drops NODE_ENV so children do not inherit the Next host's mode", () => {
    const result = env({ NODE_ENV: "production", PATH: "/usr/bin", HOME: "/home/dev" });

    expect(result.NODE_ENV).toBeUndefined();
    expect(result.PATH).toBe("/usr/bin");
    expect(result.HOME).toBe("/home/dev");
  });

  it("keeps every variable that is not an exclusion", () => {
    const result = env({ GIT_CONFIG_COUNT: "1", CI: "true", SHELL: "/bin/zsh", NODE_ENV: "production" });

    expect(result).toEqual({ GIT_CONFIG_COUNT: "1", CI: "true", SHELL: "/bin/zsh" });
  });

  it("lets an explicit override win, including NODE_ENV", () => {
    const result = env({ NODE_ENV: "production" }, { NODE_ENV: "test", EXTRA: "1" });

    expect(result.NODE_ENV).toBe("test");
    expect(result.EXTRA).toBe("1");
  });

  it("omits keys whose host value is undefined instead of serializing them", () => {
    const result = env({ PATH: "/usr/bin", UNSET_VALUE: undefined });

    expect(result).toEqual({ PATH: "/usr/bin" });
    expect("UNSET_VALUE" in result).toBe(false);
  });

  it("does not mutate the base environment", () => {
    const base = { NODE_ENV: "production", PATH: "/usr/bin" };

    env(base, { ADDED: "1" });

    expect(base).toEqual({ NODE_ENV: "production", PATH: "/usr/bin" });
  });

  it("declares NODE_ENV as the only exclusion, so additions are deliberate", () => {
    expect(CHILD_ENV_EXCLUSIONS).toEqual(["NODE_ENV"]);
  });
});
