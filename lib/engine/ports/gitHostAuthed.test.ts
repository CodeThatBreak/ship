import { describe, expect, it, vi } from "vitest";
import { AuthedUrlResolutionError } from "../../git/gitErrors";
import { authedCloneUrlFor, gitHostRegistry, gitRemoteContextFor } from "./gitHost";

describe("gitRemoteContextFor (CR-023)", () => {
  it("returns plain URL, auth env, and redact values from the host service", async () => {
    const svc = {
      authedCloneUrl: async () => "https://gitlab.example.com/group/repo.git",
      gitAuthEnv: async () => ({ GIT_CONFIG_COUNT: "1" }),
      gitRedactValues: async () => ["secret-token"],
    };
    vi.spyOn(gitHostRegistry, "forRepo").mockResolvedValue(svc as never);
    await expect(gitRemoteContextFor("https://gitlab.example.com/group/repo.git")).resolves.toEqual({
      cloneUrl: "https://gitlab.example.com/group/repo.git",
      env: { GIT_CONFIG_COUNT: "1" },
      redactSecrets: ["secret-token"],
    });
    vi.restoreAllMocks();
  });
});

describe("authedCloneUrlFor (CR-222)", () => {
  it("throws AuthedUrlResolutionError instead of falling back to the raw URL", async () => {
    vi.spyOn(gitHostRegistry, "forRepo").mockImplementation(() => {
      throw new Error("no host configured");
    });
    await expect(authedCloneUrlFor("https://gitlab.example.com/group/repo.git")).rejects.toThrow(
      AuthedUrlResolutionError,
    );
  });
});
