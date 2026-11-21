import { testGet, testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../../tests/helpers/testDatabase";

// Must run before any `../../db` import touches the connection — dynamic
// imports below resolve lazily once DATABASE_URL points at the test database.
assignTestDatabase();

const { db } = await import("../../db/app");
beforeAll(resetTestDatabase);
const { FlowDiffRefreshService } = await import("./flowDiffRefreshService");
const { flowCtxHelper } = await import("../nodes/shared/runContext");
const { ConflictError, NotFoundError, UpstreamError, ValidationError } = await import("../../errors");
import type { DiffRefreshHost } from "./types/diffRefreshHost";
import type { FlowCtx } from "../nodes/shared/nodeSharedExports";

const makeDiffSpy = vi.spyOn(flowCtxHelper, "makeDiff");

const now = () => new Date().toISOString();

/** A task + flow (+ one node row for the artifact); returns the node row id. */
const seedFlow = async (flowId: string, nodeStatus: string): Promise<string> => {
  const taskId = `task_${flowId}`;
  await testRun(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    taskId, "generic", `BR-${flowId}`, "diff refresh test", "open", "story", "P2",
  );
  await testRun(
    `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    flowId, taskId, "diff refresh test", "active", now(), now(),
  );
  const nodeId = db.uid("node_");
  await testRun(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    nodeId, flowId, "agent_1", "agent", nodeStatus, now(), now(),
  );
  return nodeId;
};

/** A `diff` artifact seeded straight through SQL, with explicit meta. */
const seedDiffArtifact = async (
  flowId: string,
  nodeId: string,
  opts: { content: string; meta: Record<string, unknown> },
): Promise<string> => {
  const id = db.uid("art_");
  await testRun(
    `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, meta, status, created_at)
     VALUES ($1,$2,$3,'diff',1,$4,$5::jsonb,'draft',now())`,
    id, nodeId, flowId, opts.content, JSON.stringify(opts.meta),
  );
  return id;
};

const readArtifact = async (id: string): Promise<{ version: number; content: string; status: string; meta: Record<string, unknown> } | null | undefined> =>
  testGet(
    `SELECT version, content, status::text AS status, meta FROM artifacts WHERE id=$1`,
    id,
  );

const readVersions = async (flowId: string): Promise<{ count: bigint } | null | undefined> =>
  testGet(`SELECT count(*) AS count FROM artifacts WHERE flow_id=$1 AND kind='diff'`, flowId);

const makeHost = (flowId: string, lifecycle: string[]): DiffRefreshHost => ({
  ctx: async () => ({ flow: { id: flowId } }) as unknown as FlowCtx,
  emitLifecycle: async (_flowId, _nodeKey, message) => {
    lifecycle.push(message);
  },
});

const AGENT_META = {
  branch: "feat/a",
  stat: "1 file changed",
  attribution: "agent",
  baseSha: "sha_base",
  headSha: "sha_h1",
};

describe("FlowDiffRefreshService (Task 08)", () => {
  it("an agent-attributed refresh preserves the agent bytes, refreshes the whole-branch projection and bumps headSha", async () => {
    const flowId = "flw_diffrefresh_agent";
    const nodeId = await seedFlow(flowId, "done");
    const artifactId = await seedDiffArtifact(flowId, nodeId, { content: "agent-bytes", meta: AGENT_META });
    const lifecycle: string[] = [];
    makeDiffSpy.mockImplementation(async () => ({
      files: [],
      stat: "2 files changed",
      raw: "whole-branch-bytes",
      baseSha: "sha_base",
      headSha: "sha_h2",
      attribution: "agent",
      alt: { attribution: "all", stat: "2 files changed", raw: "whole-branch-bytes" },
    }));

    await new FlowDiffRefreshService(makeHost(flowId, lifecycle)).refresh(flowId, artifactId);

    // a NEW version, the old one superseded
    expect(await readVersions(flowId)).toMatchObject({ count: 2n });
    expect(await readArtifact(artifactId)).toMatchObject({ status: "superseded" });
    const fresh = await testGet<{ id: string; version: number; content: string; status: string; meta: Record<string, unknown> }>(
      `SELECT id, version, content, status::text AS status, meta FROM artifacts WHERE node_id=$1 AND kind='diff' AND status='draft'`,
      nodeId,
    );
    expect(fresh?.version).toBe(2);
    // the agent projection is the finalize capture — pinned bytes; a user
    // commit made after the run never leaks into "Agent only"
    expect(fresh?.content).toBe("agent-bytes");
    expect(fresh?.meta).toMatchObject({
      branch: "feat/a",
      attribution: "agent",
      baseSha: "sha_base",
      headSha: "sha_h2", // the head anchor bumped to the live capture
      alt: { attribution: "all", raw: "whole-branch-bytes" },
    });
    expect(lifecycle).toHaveLength(1);
  });

  it("an all-attributed artifact refreshes wholesale (the content is the whole-branch projection)", async () => {
    const flowId = "flw_diffrefresh_all";
    const nodeId = await seedFlow(flowId, "done");
    const artifactId = await seedDiffArtifact(flowId, nodeId, {
      content: "old-whole-bytes",
      meta: { branch: "feat/a", stat: "s1", attribution: "all" },
    });
    const lifecycle: string[] = [];
    makeDiffSpy.mockImplementation(async () => ({
      files: [],
      stat: "3 files changed",
      raw: "new-whole-bytes",
      baseSha: null,
      headSha: "sha_h3",
      attribution: "all",
    }));

    await new FlowDiffRefreshService(makeHost(flowId, lifecycle)).refresh(flowId, artifactId);

    const fresh = await testGet<{ content: string; meta: Record<string, unknown> }>(
      `SELECT content, meta FROM artifacts WHERE node_id=$1 AND kind='diff' AND status='draft'`,
      nodeId,
    );
    expect(fresh?.content).toBe("new-whole-bytes");
    expect(fresh?.meta).toMatchObject({ attribution: "all", headSha: "sha_h3" });
    expect(fresh?.meta.baseSha).toBeUndefined();
  });

  it("an uncommitted artifact re-probes the worktree and stays uncommitted with a bumped headSha", async () => {
    const flowId = "flw_diffrefresh_uncommitted";
    const nodeId = await seedFlow(flowId, "done");
    const artifactId = await seedDiffArtifact(flowId, nodeId, {
      content: "worktree-bytes",
      meta: { ...AGENT_META, uncommitted: true },
    });
    const lifecycle: string[] = [];
    makeDiffSpy.mockImplementation(async () => ({
      files: [],
      stat: "1 file changed",
      raw: "worktree-bytes-2",
      baseSha: "sha_base",
      headSha: "sha_h2",
      attribution: "agent",
      uncommitted: true as const,
    }));

    await new FlowDiffRefreshService(makeHost(flowId, lifecycle)).refresh(flowId, artifactId);

    const fresh = await testGet<{ content: string; meta: Record<string, unknown> }>(
      `SELECT content, meta FROM artifacts WHERE node_id=$1 AND kind='diff' AND status='draft'`,
      nodeId,
    );
    expect(fresh?.content).toBe("worktree-bytes-2");
    expect(fresh?.meta).toMatchObject({ attribution: "agent", uncommitted: true, headSha: "sha_h2" });
  });

  it("a failed capture refreshes nothing (no half-established fact)", async () => {
    const flowId = "flw_diffrefresh_failed";
    const nodeId = await seedFlow(flowId, "done");
    const artifactId = await seedDiffArtifact(flowId, nodeId, { content: "agent-bytes", meta: AGENT_META });
    const lifecycle: string[] = [];
    makeDiffSpy.mockImplementation(async () => null);

    await expect(
      new FlowDiffRefreshService(makeHost(flowId, lifecycle)).refresh(flowId, artifactId),
    ).rejects.toThrow(UpstreamError);
    expect(await readVersions(flowId)).toMatchObject({ count: 1n });
  });

  it("a running node's attempt owns the capture — the refresh refuses without running git", async () => {
    const flowId = "flw_diffrefresh_running";
    const nodeId = await seedFlow(flowId, "running");
    const artifactId = await seedDiffArtifact(flowId, nodeId, { content: "agent-bytes", meta: AGENT_META });
    makeDiffSpy.mockClear();

    await expect(
      new FlowDiffRefreshService(makeHost(flowId, [])).refresh(flowId, artifactId),
    ).rejects.toThrow(ConflictError);
    expect(makeDiffSpy).not.toHaveBeenCalled();
    expect(await readVersions(flowId)).toMatchObject({ count: 1n });
  });

  it("a non-diff artifact and a superseded version are rejected, and a missing artifact is not found", async () => {
    const flowId = "flw_diffrefresh_guards";
    const nodeId = await seedFlow(flowId, "done");
    const service = new FlowDiffRefreshService(makeHost(flowId, []));

    const planId = db.uid("art_");
    await testRun(
      `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, status, created_at)
       VALUES ($1,$2,$3,'plan',1,'plan body','draft',now())`,
      planId, nodeId, flowId,
    );
    await expect(service.refresh(flowId, planId)).rejects.toThrow(ValidationError);
    await expect(service.refresh(flowId, "art_missing")).rejects.toThrow(NotFoundError);

    // the newest diff version refreshes; the superseded one does not
    const v1 = await seedDiffArtifact(flowId, nodeId, { content: "agent-bytes", meta: AGENT_META });
    makeDiffSpy.mockImplementation(async () => ({ files: [], stat: "s", raw: "r", baseSha: "sha_base", headSha: "sha_h2", attribution: "agent" }));
    await service.refresh(flowId, v1);
    makeDiffSpy.mockClear();
    await expect(service.refresh(flowId, v1)).rejects.toThrow(ConflictError);
    expect(makeDiffSpy).not.toHaveBeenCalled();
  });
});