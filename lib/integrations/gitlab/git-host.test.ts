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
});
