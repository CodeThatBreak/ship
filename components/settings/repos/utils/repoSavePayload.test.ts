import { describe, expect, it } from "vitest";
import type { Repo } from "@/components/settings/context";
import { EMPTY_REPO_FORM } from "../hooks/useRepoForm";
import {
  buildRepoSavePayload,
  touchedPolicyFromRepo,
} from "./repoSavePayload";

const baseRepo: Repo = {
  id: "r1",
  name: "api",
  cloudUrl: "https://gitlab.com/g/api",
  localPath: "/Users/Shared/api",
  defaultBranch: "main",
  useWorktrees: 1,
  installCommand: null,
  skipInstall: 0,
  syncPaths: null,
  sharedDirs: null,
  setupCommand: null,
  worktreeTimeoutMs: null,
};

describe("buildRepoSavePayload", () => {
  it("omits untouched policy fields on edit so auto-detection is preserved", () => {
    const state = {
      ...EMPTY_REPO_FORM,
      name: "api-renamed",
      cloudUrl: baseRepo.cloudUrl,
      localPath: "/Users/Shared/api",
      defaultBranch: "main",
      syncPaths: ".env*\nfrom-detect-should-not-save",
    };
    const payload = buildRepoSavePayload(state, new Set(), "r1");
    expect(payload.name).toBe("api-renamed");
    expect("installCommand" in payload).toBe(false);
    expect("syncPaths" in payload).toBe(false);
  });

  it("includes policy fields the user touched", () => {
    const state = {
      ...EMPTY_REPO_FORM,
      name: "api",
      cloudUrl: baseRepo.cloudUrl,
      installCommand: "pnpm install",
    };
    const payload = buildRepoSavePayload(
      state,
      new Set(["installCommand"]),
      null,
    );
    expect(payload.installCommand).toBe("pnpm install");
    expect("syncPaths" in payload).toBe(false);
  });
});

describe("touchedPolicyFromRepo", () => {
  it("marks columns that already had overrides", () => {
    const touched = touchedPolicyFromRepo({
      ...baseRepo,
      installCommand: "npm ci",
      syncPaths: ".env*",
    });
    expect(touched.has("installCommand")).toBe(true);
    expect(touched.has("syncPaths")).toBe(true);
    expect(touched.has("sharedDirs")).toBe(false);
  });

  it("marks the worktree opt-out as touched only when disabled", () => {
    expect(touchedPolicyFromRepo({ ...baseRepo, useWorktrees: 1 }).has("useWorktrees")).toBe(false);
    expect(touchedPolicyFromRepo({ ...baseRepo, useWorktrees: 0 }).has("useWorktrees")).toBe(true);
  });
});
