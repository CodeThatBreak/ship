import { describe, expect, it, vi } from "vitest";
import type { JiraInstanceMeta } from "../../db/stores/jira-instance-store";
import type { JiraInstanceStore } from "../../db/stores";

vi.mock("../../db", () => ({
  jiraInstanceStore: {
    listMeta: vi.fn(() => []),
    add: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

const { JiraService } = await import("./service");

describe("JiraService", () => {
  const makeStore = (listMeta: JiraInstanceMeta[]) => ({
    listMeta: vi.fn(() => listMeta),
    get: vi.fn(),
    readToken: vi.fn(),
    add: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  });

  it("rejects registering a second instance", () => {
    const svc = new JiraService(
      makeStore([
        {
          id: "jri_1",
          name: null,
          base_url: "https://a.atlassian.net",
          email: "a@b.c",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ]) as unknown as JiraInstanceStore,
    );
    expect(() =>
      svc.addInstance({ base_url: "https://b.atlassian.net", email: "x@y.z", token: "tok" }),
    ).toThrow(/Only one Jira instance/);
  });
});
