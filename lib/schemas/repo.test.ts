import { describe, expect, it } from "vitest";
import {
  expandRepoLocalPath,
  isAllowedTildePrefix,
  repoCreateBodySchema,
  repoDetectQuerySchema,
  repoPatchBodySchema,
  repoTestSetupBodySchema,
} from "./repo";

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
    expect(repoCreateBodySchema.safeParse({ name: "a", cloudUrl: "https://x", localPath: "~bob/x" }).success).toBe(
      false,
    );
  });
});

describe("repoCreateBodySchema", () => {
  it("accepts scp-style cloudUrl values", () => {
    const parsed = repoCreateBodySchema.parse({
      name: "devflow",
      cloudUrl: "git@gitlab.example.com:acme/webapp.git",
    });
    expect(parsed.cloudUrl).toBe("git@gitlab.example.com:acme/webapp.git");
  });

  it("maps empty optional strings to null", () => {
    const parsed = repoCreateBodySchema.parse({
      name: "devflow",
      cloudUrl: "https://gitlab.example.com/a/b",
      installCommand: "  ",
    });
    expect(parsed.installCommand).toBeNull();
  });

  it("converts worktreeTimeoutS to milliseconds", () => {
    const parsed = repoCreateBodySchema.parse({
      name: "devflow",
      cloudUrl: "https://gitlab.example.com/a/b",
      worktreeTimeoutS: 120,
    });
    expect(parsed.worktreeTimeoutS).toBe(120_000);
  });

  it("accepts the camelCase payload the repo form sends", () => {
    const parsed = repoCreateBodySchema.parse({
      name: "devflow",
      cloudUrl: "https://gitlab.example.com/a/b",
      localPath: "~/work/devflow",
      defaultBranch: "main",
      useWorktrees: false,
      skipInstall: true,
      syncPaths: ".env*",
      sharedDirs: ".turbo",
      setupCommand: "make bootstrap",
      worktreeTimeoutS: 120,
    });
    expect(parsed).toMatchObject({
      localPath: `${process.env.HOME ?? ""}/work/devflow`,
      defaultBranch: "main",
      useWorktrees: false,
      skipInstall: true,
      syncPaths: ".env*",
      sharedDirs: ".turbo",
      setupCommand: "make bootstrap",
      worktreeTimeoutS: 120_000,
    });
  });
});

describe("repoPatchBodySchema", () => {
  it("accepts the camelCase fields the repo form patches", () => {
    const parsed = repoPatchBodySchema.parse({
      cloudUrl: "https://gitlab.example.com/a/b",
      localPath: "/tmp/repo",
      defaultBranch: "develop",
      installCommand: "pnpm install",
      worktreeTimeoutS: "90",
    });
    expect(parsed).toMatchObject({
      cloudUrl: "https://gitlab.example.com/a/b",
      localPath: "/tmp/repo",
      defaultBranch: "develop",
      installCommand: "pnpm install",
      worktreeTimeoutS: 90_000,
    });
  });
});

describe("repoDetectQuerySchema / repoTestSetupBodySchema", () => {
  it("accepts localPath on the detect query", () => {
    expect(repoDetectQuerySchema.parse({ localPath: "~/work/devflow" }).localPath).toBe("~/work/devflow");
  });

  it("accepts the camelCase setup-test payload", () => {
    const parsed = repoTestSetupBodySchema.parse({
      localPath: "~/work/devflow",
      defaultBranch: "",
      installCommand: "pnpm install",
      worktreeTimeoutS: 120,
    });
    expect(parsed).toMatchObject({
      localPath: `${process.env.HOME ?? ""}/work/devflow`,
      defaultBranch: null,
      installCommand: "pnpm install",
      worktreeTimeoutS: 120_000,
    });
  });
});
