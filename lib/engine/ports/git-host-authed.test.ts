import { describe, expect, it, vi } from "vitest";
import { AuthedUrlResolutionError } from "../../git/git-errors";
import { authedCloneUrlFor, gitHostRegistry } from "./git-host";

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
