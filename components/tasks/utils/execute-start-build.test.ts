import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveTask, RepoSummary } from "@/types/tasks";
import { RUN_MODE } from "@/constants/execution";
import { executeStartBuild } from "./execute-start-build";

const task: LiveTask = {
  type: "jira",
  id: "1",
  key: "DEV-1",
  summary: "Fix feed",
  description: "",
  status: "Open",
  issueType: "Task",
  priority: "Medium",
  externalUrl: "https://jira.example/DEV-1",
  parentKey: "",
  fields: {},
  raw: {},
};

const repo: RepoSummary = {
  id: "repo-1",
  name: "devflow",
  cloud_url: "https://gitlab.com/g/devflow",
  local_path: "/Users/me/devflow",
};

describe("executeStartBuild (CR-153)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws when repo pin PATCH fails and does not create a flow", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.endsWith("/api/tasks/materialize")) {
        return new Response(JSON.stringify({ id: "task-db-1" }), { status: 200 });
      }
      if (url.includes("/api/tasks/task-db-1")) {
        return new Response(JSON.stringify({ error: "pin failed" }), { status: 400 });
      }
      if (url.endsWith("/api/flows")) {
        return new Response(JSON.stringify({ id: "flow-1" }), { status: 200 });
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      executeStartBuild({ task, repo, executionMode: RUN_MODE.CLOUD, templateId: "tpl-1" }),
    ).rejects.toThrow("pin failed");

    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/api/flows"))).toBe(false);
  });

  it("surfaces server JSON errors from materialize instead of a parse failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "store failed" }), { status: 500 })),
    );

    await expect(
      executeStartBuild({ task, repo, executionMode: RUN_MODE.CLOUD, templateId: "tpl-1" }),
    ).rejects.toThrow("store failed");
  });
});
