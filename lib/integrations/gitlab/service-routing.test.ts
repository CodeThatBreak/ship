import { describe, expect, it } from "vitest";

import type { GitLabInstanceStore } from "../../db/stores";
import { GitLabService } from "./client";

describe("GitLabService.instanceForRepo (CR-024)", () => {
  const instance = {
    id: "gli_1",
    name: null,
    base_url: "https://gitlab.example.com",
    token: "secret-token",
    created_at: "2026-01-01T00:00:00.000Z",
  };

  const database = {
    uid: () => "id",
    now: () => new Date().toISOString(),
    normalizeRepoUrl: (u: string) => u,
  };

  const store = {
    list: () => [instance],
    add: () => instance,
    update: () => undefined,
    delete: () => undefined,
  } as unknown as GitLabInstanceStore;

  it("does not route foreign hosts through a single registered instance", () => {
    const svc = new GitLabService(store, database);
    expect(() => svc.instanceForRepo("https://github.com/org/repo.git")).toThrow(/No GitLab instance/);
  });

  it("allows the lone instance for SSH-style URLs with no host", () => {
    const svc = new GitLabService(store, database);
    expect(svc.instanceForRepo("git@gitlab.example.com:group/repo.git").id).toBe("gli_1");
  });
});
