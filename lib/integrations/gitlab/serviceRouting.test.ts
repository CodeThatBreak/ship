import { describe, expect, it } from "vitest";

import type { GitLabInstanceStore } from "../../db/stores/storeExports";
import { GitLabService } from "./client";

describe("GitLabService.instanceForRepo (CR-024)", () => {
  const meta = {
    id: "gli_1",
    name: null,
    base_url: "https://gitlab.example.com",
    created_at: "2026-01-01T00:00:00.000Z",
  };

  const database = {
    uid: () => "id",
    now: () => new Date().toISOString(),
    normalizeRepoUrl: (u: string) => u,
  };

  const store = {
    listMeta: () => [meta],
    readToken: () => "secret-token",
    get: () => ({ ...meta, token: "secret-token" }),
    add: () => ({ ...meta, token: "secret-token" }),
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
