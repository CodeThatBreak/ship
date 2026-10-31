import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "../../errors";
import type { GitLabService } from "./client";
import { GitLabHostService } from "./git-host";

describe("GitLabHostService", () => {
  const gitlab = {
    configured: () => true,
    instanceForRepo: vi.fn(() => ({
      id: "gli_1",
      name: null,
      base_url: "https://gitlab.example.com",
      token: "secret-token",
      created_at: "2026-01-01T00:00:00.000Z",
    })),
    clientFor: vi.fn(),
    projectPathFromUrl: () => "group/repo",
    listInstances: vi.fn<GitLabService["listInstances"]>(() => []),
    addInstance: vi.fn(),
    updateInstance: vi.fn(),
    deleteInstance: vi.fn(),
    testInstance: vi.fn(),
  };

  const service = new GitLabHostService(gitlab as unknown as GitLabService);

  it("builds an authenticated clone URL with oauth2 and a .git suffix", () => {
    vi.mocked(gitlab.instanceForRepo).mockReturnValue({
      id: "gli_1",
      name: null,
      base_url: "https://gitlab.example.com",
      token: "secret-token",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    const url = service.authedCloneUrl("https://gitlab.example.com/group/repo");
    expect(url).toBe("https://oauth2:secret-token@gitlab.example.com/group/repo.git");
  });

  it("passes through the repo URL when no token is available", () => {
    vi.mocked(gitlab.instanceForRepo).mockImplementation(() => {
      throw new Error("no instance");
    });
    expect(service.authedCloneUrl("https://gitlab.example.com/group/repo.git")).toBe(
      "https://gitlab.example.com/group/repo.git",
    );
  });

  it("rejects testInstance when baseUrl changes without a new token (CR-002)", async () => {
    vi.mocked(gitlab.listInstances).mockReturnValue([
      {
        id: "gli_1",
        name: null,
        base_url: "https://gitlab.example.com",
        token: "secret-token",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    await expect(
      service.testInstance("gli_1", { baseUrl: "https://evil.test" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("parseWebhook maps a GitLab note payload to a CR comment event", () => {
    const event = service.parseWebhook({
      object_kind: "note",
      project: { id: 42, web_url: "https://gitlab.example.com/group/repo" },
      merge_request: { iid: 7 },
      object_attributes: {
        id: 99,
        note: "please fix",
        type: "DiffNote",
        discussion_id: "disc_1",
        created_at: "2026-01-01T00:00:00.000Z",
        position: { new_path: "a.ts", new_line: 10 },
      },
      user: { username: "dev" },
    });
    expect(event?.kind).toBe("cr_comment");
    if (event?.kind === "cr_comment") {
      expect(event.crNumber).toBe(7);
      expect(event.comment.body).toBe("please fix");
    }
  });
});
