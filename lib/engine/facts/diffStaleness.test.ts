import { testRun } from "@/tests/helpers/rawTestDb";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../../tests/helpers/testDatabase";

// Must run before any `../../db` import touches the connection — dynamic
// imports below resolve lazily once DATABASE_URL points at the test database.
assignTestDatabase();

const { db } = await import("../../db/app");
beforeAll(resetTestDatabase);
const { diffStaleness } = await import("./diffStaleness");
const { localGit } = await import("../../git/local");

const now = () => new Date().toISOString();

const tmpDirs: string[] = [];
const repoCheckout = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-staleprobe-"));
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true }); // the checkout's git marker
  tmpDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tmpDirs.map((d) => fs.promises.rm(d, { recursive: true, force: true })));
  tmpDirs.length = 0;
});

/** A task + flow (+ one node + one branch row + a registered repo with a
 *  local checkout); returns the node row id. */
const seedFlow = async (flowId: string, opts: { branchName?: string; gitBranch?: string | null } = {}): Promise<string> => {
  const taskId = `task_${flowId}`;
  await testRun(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    taskId, "generic", `BR-${flowId}`, "staleness test", "open", "story", "P2",
  );
  await testRun(
    `INSERT INTO repos (id, name, cloud_url, local_path, created_at, updated_at)
     VALUES ($1,'staleness test',$2,$3,now(),now())`,
    `repo_${flowId}`,
    `https://git/${flowId}.git`,
    repoCheckout(),
  );
  await testRun(
    `INSERT INTO flows (id, task_id, name, status, repo_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    flowId, taskId, "staleness test", "active", `repo_${flowId}`, now(), now(),
  );
  const nodeId = db.uid("node_");
  await testRun(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    nodeId, flowId, "agent_1", "agent", "done", now(), now(),
  );
  if (opts.branchName) {
    await testRun(
      `INSERT INTO branches (id, flow_id, name, title, status, git_branch, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'building',$5,now(),now())`,
      db.uid("br_"), flowId, opts.branchName, opts.branchName, opts.gitBranch ?? null,
    );
  }
  return nodeId;
};

const seedDiffArtifact = async (
  flowId: string,
  nodeId: string,
  kind: string,
  meta: Record<string, unknown> | null,
): Promise<string> => {
  const id = db.uid("art_");
  await testRun(
    `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, meta, status, created_at)
     VALUES ($1,$2,$3,$4,1,'raw',$5,'draft',now())`,
    id, nodeId, flowId, kind, meta === null ? null : JSON.stringify(meta),
  );
  return id;
};

const readRow = async (id: string): Promise<unknown> =>
  db.prisma.artifact.findUniqueOrThrow({ where: { id } });

describe("DiffStalenessProbe (Task 08)", () => {
  it("the live branch head differing from the capture's headSha reads as stale", async () => {
    const flowId = "flw_stale_moved";
    const nodeId = await seedFlow(flowId, { branchName: "feat/a", gitBranch: "bugfix/feat-a" });
    const id = await seedDiffArtifact(flowId, nodeId, "diff", { branch: "feat/a", stat: "s", headSha: "sha_h1" });
    const probe = vi.spyOn(localGit, "resolveSha").mockResolvedValue("sha_h2");

    const described = await diffStaleness.describe(await readRow(id) as never);

    expect(probe).toHaveBeenCalledWith(expect.anything(), "bugfix/feat-a");
    expect(described.branchHeadStale).toBe(true);
    probe.mockRestore();
  });

  it("the head matching the capture reads as current, and an unprobeable branch never fabricates staleness", async () => {
    const flowId = "flw_stale_current";
    const nodeId = await seedFlow(flowId, { branchName: "feat/a" });
    const id = await seedDiffArtifact(flowId, nodeId, "diff", { branch: "feat/a", stat: "s", headSha: "sha_h1" });
    const probe = vi.spyOn(localGit, "resolveSha").mockResolvedValue("sha_h1");

    expect((await diffStaleness.describe(await readRow(id) as never)).branchHeadStale).toBe(false);

    probe.mockResolvedValue(null);
    expect((await diffStaleness.describe(await readRow(id) as never)).branchHeadStale).toBeUndefined();
    probe.mockRestore();
  });

  it("non-diff artifacts and diff facts without a head anchor return unchanged", async () => {
    const flowId = "flw_stale_plain";
    const nodeId = await seedFlow(flowId);
    const planId = await seedDiffArtifact(flowId, nodeId, "plan", { branch: "feat/a" });
    const diffId = await seedDiffArtifact(flowId, nodeId, "diff", { branch: "feat/a", stat: "s" });

    const probe = vi.spyOn(localGit, "resolveSha");
    expect((await diffStaleness.describe(await readRow(planId) as never)).branchHeadStale).toBeUndefined();
    expect((await diffStaleness.describe(await readRow(diffId) as never)).branchHeadStale).toBeUndefined();
    expect(probe).not.toHaveBeenCalled();
    probe.mockRestore();
  });
});