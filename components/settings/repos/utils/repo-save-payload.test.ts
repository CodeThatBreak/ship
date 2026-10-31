import { describe, expect, it } from "vitest";
import type { Repo } from "@/components/settings";
import { EMPTY_REPO_FORM } from "../hooks/use-repo-form";
import {
  buildRepoSavePayload,
  touchedPolicyFromRepo,
} from "./repo-save-payload";

const baseRepo: Repo = {
  id: "r1",
  name: "api",
  cloud_url: "https://gitlab.com/g/api",
  local_path: "/Users/Shared/api",
  default_branch: "main",
  install_command: null,
  sync_paths: null,
};

describe("buildRepoSavePayload", () => {
  it("omits untouched policy fields on edit so auto-detection is preserved", () => {
    const state = {
      ...EMPTY_REPO_FORM,
      name: "api-renamed",
      cloud_url: baseRepo.cloud_url,
      local_path: "/Users/Shared/api",
      default_branch: "main",
      sync_paths: ".env*\nfrom-detect-should-not-save",
    };
    const payload = buildRepoSavePayload(state, new Set(), "r1");
    expect(payload.name).toBe("api-renamed");
    expect("install_command" in payload).toBe(false);
    expect("sync_paths" in payload).toBe(false);
  });

  it("includes policy fields the user touched", () => {
    const state = {
      ...EMPTY_REPO_FORM,
      name: "api",
      cloud_url: baseRepo.cloud_url,
      install_command: "pnpm install",
    };
    const payload = buildRepoSavePayload(
      state,
      new Set(["install_command"]),
      null,
    );
    expect(payload.install_command).toBe("pnpm install");
    expect("sync_paths" in payload).toBe(false);
  });
});

describe("touchedPolicyFromRepo", () => {
  it("marks columns that already had overrides", () => {
    const touched = touchedPolicyFromRepo({
      ...baseRepo,
      install_command: "npm ci",
      sync_paths: ".env*",
    });
    expect(touched.has("install_command")).toBe(true);
    expect(touched.has("sync_paths")).toBe(true);
    expect(touched.has("shared_dirs")).toBe(false);
  });
});
