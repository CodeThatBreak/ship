import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHostApiError, GitHostTimeoutError } from "../../engine/ports/git-host-errors";
import { GITLAB_HTTP_TIMEOUT_MS } from "./constants";
import { GitLabClient } from "./client";

const instance = {
  id: "gli_test",
  name: null,
  base_url: "https://gitlab.example.com",
  token: "secret-token",
};

const jsonResponse = (body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  });

describe("GitLabClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("paginates list endpoints until x-next-page is empty", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{ id: 1 }], { "x-next-page": "2", "x-page": "1" }))
      .mockResolvedValueOnce(jsonResponse([{ id: 2 }], { "x-page": "2" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GitLabClient(instance);
    const jobs = await client.listPipelineJobs("group%2Frepo", 99);

    expect(jobs).toEqual([{ id: 1 }, { id: 2 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("per_page=100&page=1");
    expect(String(fetchMock.mock.calls[1][0])).toContain("page=2");
  });

  it("throws GitHostApiError with HTTP status on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 404, statusText: "Not Found" })),
    );

    const client = new GitLabClient(instance);
    await expect(client.getMR("group%2Frepo", 1)).rejects.toMatchObject({
      httpStatus: 404,
      path: "/projects/group%2Frepo/merge_requests/1",
    } satisfies Partial<GitHostApiError>);
  });

  it("maps AbortSignal timeout to GitHostTimeoutError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("Timeout"), { name: "TimeoutError" })),
    );

    const client = new GitLabClient(instance);
    await expect(client.getMR("group%2Frepo", 1)).rejects.toBeInstanceOf(GitHostTimeoutError);
    await expect(client.getMR("group%2Frepo", 1)).rejects.toMatchObject({
      path: "/projects/group%2Frepo/merge_requests/1",
    });
    expect(GITLAB_HTTP_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("loads MR diffs from the /diffs endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse([{ old_path: "a.ts", new_path: "a.ts", diff: "+line" }]),
      ),
    );

    const client = new GitLabClient(instance);
    const { diffs, truncated } = await client.getMRDiffs("group%2Frepo", 3);
    expect(truncated).toBe(false);
    expect(diffs).toEqual([{ old_path: "a.ts", new_path: "a.ts", diff: "+line" }]);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("/merge_requests/3/diffs");
  });
});
