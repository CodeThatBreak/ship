import { describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  gitLab: {
    configured: () => true,
    instanceForRepo: vi.fn(() => ({ token: "secret-token" })),
    clientFor: vi.fn(),
    projectPathFromUrl: () => "group/repo",
    listInstances: () => [],
  },
}));

const { gitLab } = await import("./client");
const { GitLabHostService } = await import("./git-host");

describe("GitLabHostService", () => {
  const service = new GitLabHostService();

  it("builds an authenticated clone URL with oauth2 and a .git suffix", () => {
    vi.mocked(gitLab.instanceForRepo).mockReturnValue({ token: "secret-token" } as never);
    const url = service.authedCloneUrl("https://gitlab.example.com/group/repo");
    expect(url).toBe("https://oauth2:secret-token@gitlab.example.com/group/repo.git");
  });

  it("passes through the repo URL when no token is available", () => {
    vi.mocked(gitLab.instanceForRepo).mockImplementation(() => {
      throw new Error("no instance");
    });
    expect(service.authedCloneUrl("https://gitlab.example.com/group/repo.git")).toBe(
      "https://gitlab.example.com/group/repo.git",
    );
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
