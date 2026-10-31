import { describe, expect, it } from "vitest";
import { expandRepoLocalPath, isAllowedTildePrefix, repoCreateBodySchema } from "./repo";

describe("expandRepoLocalPath", () => {
  it("expands ~ and ~/ prefixes only", () => {
    const home = process.env.HOME ?? "";
    expect(expandRepoLocalPath("~/projects/devflow")).toBe(`${home}/projects/devflow`);
    expect(expandRepoLocalPath("~")).toBe(home);
  });

  it("leaves absolute paths unchanged", () => {
    expect(expandRepoLocalPath("/tmp/repo")).toBe("/tmp/repo");
  });

  it("rejects ~user paths at the schema boundary", () => {
    expect(isAllowedTildePrefix("~bob/x")).toBe(false);
    expect(repoCreateBodySchema.safeParse({ name: "a", cloud_url: "https://x", local_path: "~bob/x" }).success).toBe(
      false,
    );
  });
});

describe("repoCreateBodySchema", () => {
  it("maps empty optional strings to null", () => {
    const parsed = repoCreateBodySchema.parse({
      name: "devflow",
      cloud_url: "https://gitlab.example.com/a/b",
      install_command: "  ",
    });
    expect(parsed.install_command).toBeNull();
  });

  it("converts worktree_timeout_s to milliseconds", () => {
    const parsed = repoCreateBodySchema.parse({
      name: "devflow",
      cloud_url: "https://gitlab.example.com/a/b",
      worktree_timeout_s: 120,
    });
    expect(parsed.worktree_timeout_s).toBe(120_000);
  });
});
