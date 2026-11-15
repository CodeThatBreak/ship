import { describe, expect, it, vi } from "vitest";
import type { JiraInstanceMeta } from "../../db/stores/jiraInstanceStore";
import type { JiraInstanceStore } from "../../db/stores/storeExports";

vi.mock("../../db", () => ({
  jiraInstanceStore: {
    listMeta: vi.fn(async () => []),
    add: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

const { JiraService } = await import("./service");

describe("JiraService", () => {
  const makeStore = (listMeta: JiraInstanceMeta[]) => ({
    listMeta: vi.fn(async () => listMeta),
    get: vi.fn(),
    readToken: vi.fn(),
    add: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  });

  it("rejects registering a second instance", async () => {
    const svc = new JiraService(
      makeStore([
        {
          id: "jri_1",
          name: null,
          baseUrl: "https://a.atlassian.net",
          email: "a@b.c",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ]) as unknown as JiraInstanceStore,
    );
    await expect(
      svc.addInstance({ baseUrl: "https://b.atlassian.net", email: "x@y.z", token: "tok" }),
    ).rejects.toThrow(/Only one Jira instance/);
  });
});
