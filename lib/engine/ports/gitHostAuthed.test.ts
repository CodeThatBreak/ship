import { describe, expect, it, vi } from "vitest";
import { AuthedUrlResolutionError } from "../../git/gitErrors";
import { authedCloneUrlFor, gitHostRegistry, gitRemoteContextFor } from "./gitHost";

describe("gitRemoteContextFor (CR-023)", () => {
  it("returns plain URL, auth env, and redact values from the host service", () => {
    const svc = {
      authedCloneUrl: () => "https://gitlab.example.com/group/repo.git",
      gitAuthEnv: () => ({ GIT_CONFIG_COUNT: "1" }),
      gitRedactValues: () => ["secret-token"],
    };
    vi.spyOn(gitHostRegistry, "forRepo").mockReturnValue(svc as never);
    expect(gitRemoteContextFor("https://gitlab.example.com/group/repo.git")).toEqual({
      cloneUrl: "https://gitlab.example.com/group/repo.git",
      env: { GIT_CONFIG_COUNT: "1" },
      redactSecrets: ["secret-token"],
    });
    vi.restoreAllMocks();
  });
});

describe("authedCloneUrlFor (CR-222)", () => {
  it("throws AuthedUrlResolutionError instead of falling back to the raw URL", () => {
    vi.spyOn(gitHostRegistry, "forRepo").mockImplementation(() => {
      throw new Error("no host configured");
    });
    expect(() => authedCloneUrlFor("https://gitlab.example.com/group/repo.git")).toThrow(
      AuthedUrlResolutionError,
    );
  });
});
