import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({
  db: {
    all: vi.fn(() => []),
    run: vi.fn(),
    uid: vi.fn(() => "jri_new"),
    now: vi.fn(() => "2026-01-01T00:00:00.000Z"),
  },
}));

const { db } = await import("../../db");
const { JiraService } = await import("./service");

describe("JiraService", () => {
  beforeEach(() => {
    vi.mocked(db.all).mockReturnValue([]);
  });

  it("rejects registering a second instance", () => {
    vi.mocked(db.all).mockReturnValue([
      { id: "jri_1", name: null, base_url: "https://a.atlassian.net", email: "a@b.c", token: "t" },
    ]);
    const svc = new JiraService();
    expect(() =>
      svc.addInstance({ base_url: "https://b.atlassian.net", email: "x@y.z", token: "tok" }),
    ).toThrow(/Only one Jira instance/);
  });
});
