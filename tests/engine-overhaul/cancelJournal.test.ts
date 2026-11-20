/**
 * Cancel + MR-create journals (engine overhaul step 06, tasks 4+5,
 * Invariant 7): the external-I/O sequences are journaled write-ahead through
 * the `jobs` table. A crash between the write-ahead claim and the finalize
 * leaves a `claimed` job whose lease expiry the worker sweep re-claims —
 * the same handler the inline path ran, so the side effect lands exactly once:
 *
 *  - cancel: the node finalizes failed + its runs error (orphaned intent
 *    finalized by the sweep; inline path unchanged end-to-end).
 *  - mr_create: the re-claim's adopt path (`listChangeRequestsByBranch`)
 *    lands the already-created MR instead of duplicating it; the
 *    flows-row update and the job's completion share one transaction.
 *  - CommitError (fix budget exhausted) is a NORMAL terminal: mr-failed
 *    event + declared `mrHandback`, job done — not a crash to requeue.
 *
 * Runs against the isolated dockerized Postgres test database
 * (AGENTS.md §1 — never a demo/real DB).
 */
import { beforeAll, describe, expect, test } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../helpers/testDatabase";
import { FlowHarness } from "../helpers/flowHarness";
import { registerFakeAgentPort, type FakeAgentPort } from "../helpers/fakeAgentPort";
import { registerFakeGitHost, type FakeGitHost } from "../helpers/fakeGitHost";

assignTestDatabase();

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");
const { NODE_KEYS } = await import("@/lib/engine/constants/nodeKeys");
const { flowCtxHelper } = await import("@/lib/engine/nodes/shared/runContext");
const { JobQueue } = await import("@/lib/engine/runtime/jobs/jobQueue");
const { CancelHandler } = await import("@/lib/engine/runtime/jobs/cancelHandler");
const { MrCreateHandler } = await import("@/lib/engine/runtime/jobs/mrCreateHandler");
const { JOB_KIND } = await import("@/lib/engine/runtime/jobs/constants/jobVocabulary");
const { cancelDedupKey, mrCreateDedupKey } = await import("@/lib/engine/runtime/jobs/utils/jobDedupKeys");
const { CommitError } = await import("@/lib/engine/nodes/kinds/mergeRequest/mergeRequestExports");

const agent = registerFakeAgentPort((v) => db.setSetting("default_harness", v)) as FakeAgentPort;
const gitHost = registerFakeGitHost() as FakeGitHost;
const harness = new FlowHarness({ db, flowEngine, templateStore });

beforeAll(resetTestDatabase);

/** Fixture: place a node in `running` with one live run row (what an
 *  interrupted stage looks like to the engine). Returns the run ref. */
const placeRunningWithRun = async (flowId: string, nodeKey: string): Promise<string> => {
  await harness.setNodeForFixture(flowId, nodeKey, "running");
  const node = await db.get<{ id: string }>(
    `SELECT id FROM nodes WHERE flow_id=$1 AND node_key=$2`, flowId, nodeKey,
  );
  if (!node) throw new Error(`fixture: no node row for ${nodeKey}`);
  const runRef = `run_cancel_${node.id.slice(-6)}`;
  await db.run(
    `INSERT INTO runs (id, flow_id, node_id, agent_ref, run_ref, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,'running',$6,$7)`,
    db.uid("run_"), flowId, node.id, "agent_fixture", runRef, db.now(), db.now(),
  );
  return runRef;
};

/** The job row's status + dedup key by id. */
const jobRowOf = async (jobId: string): Promise<{ status: string; dedupKey: string | null }> => {
  const row = await db.get<{ status: string; dedupKey: string | null }>(
    `SELECT status, dedup_key AS "dedupKey" FROM jobs WHERE id=$1`, jobId,
  );
  if (!row) throw new Error(`fixture: no job row ${jobId}`);
  return row;
};

describe("cancel journal (step 06 task 4)", () => {
  test("an orphaned cancel intent is finalized by the job sweep", async () => {
    const flowId = await harness.seedSdlcFlow();
    const buildKey = await flowEngine.keyOfRole(flowId, NODE_KEYS.BUILD);
    if (!buildKey) throw new Error("expected a build node");
    const runRef = await placeRunningWithRun(flowId, buildKey);

    // write-ahead: enqueue + claim, then "crash" — the intent is journaled,
    // the node untouched (the finalize never ran)
    const jobs = new JobQueue();
    const { id: jobId } = await jobs.enqueue({
      kind: JOB_KIND.CANCEL, flowId,
      dedupKey: cancelDedupKey(flowId, buildKey),
      payload: { flowId, nodeKey: buildKey },
    });
    expect((await jobs.claimById(jobId))?.id).toBe(jobId);
    expect(await harness.nodeStatus(flowId, buildKey)).toBe("running");

    // crash window: the claim lease lapses; the sweep re-claims and finalizes
    // with the SAME handler the inline path would run
    await db.run(`UPDATE jobs SET lease_until = now() - interval '1 second' WHERE id=$1`, jobId);
    const processed = await jobs.sweepDue({
      [JOB_KIND.CANCEL]: (job) => new CancelHandler(jobs).handle(job),
    });
    expect(processed).toBe(1);

    expect(await harness.nodeStatus(flowId, buildKey)).toBe("failed");
    const run = await db.get<{ status: string; leaseUntil: string | null }>(
      `SELECT status, lease_until AS "leaseUntil" FROM runs WHERE run_ref=$1`, runRef,
    );
    expect(run?.status).toBe("error");
    expect(run?.leaseUntil).toBeNull();
    const job = await jobRowOf(jobId);
    expect(job.status).toBe("done");
    expect(job.dedupKey).toBeNull(); // freed — the node can be cancelled again after a retry
  }, 15_000);

  test("inline cancel still finalizes end-to-end, and a retried node can be cancelled again", async () => {
    const flowId = await harness.seedSdlcFlow();
    const buildKey = await flowEngine.keyOfRole(flowId, NODE_KEYS.BUILD);
    if (!buildKey) throw new Error("expected a build node");
    const runRef = await placeRunningWithRun(flowId, buildKey);

    await flowEngine.cancelNode(flowId, buildKey);
    expect(await harness.nodeStatus(flowId, buildKey)).toBe("failed");
    expect(agent.wasCancelled(runRef)).toBe(true); // the remote cancel ran
    const job = await db.get<{ status: string }>(
      `SELECT status FROM jobs WHERE flow_id=$1 AND kind='cancel' ORDER BY created_at DESC LIMIT 1`,
      flowId,
    );
    expect(job?.status).toBe("done");

    // the upfront guard is validation, not dedup: a terminal node refuses
    await expect(flowEngine.cancelNode(flowId, buildKey)).rejects.toThrow(/cannot cancel/);

    // retry → running again → a SECOND cancel must work (the first intent's
    // dedup key was freed on completion)
    const runRef2 = await placeRunningWithRun(flowId, buildKey);
    await flowEngine.cancelNode(flowId, buildKey);
    expect(await harness.nodeStatus(flowId, buildKey)).toBe("failed");
    expect(agent.wasCancelled(runRef2)).toBe(true);
  }, 15_000);
});

describe("mr_create journal (step 06 task 5)", () => {
  test("a crashed creation is re-claimed by the sweep and adopts the existing MR", async () => {
    const flowId = await harness.seedSdlcFlow();
    const buildKey = await flowEngine.keyOfRole(flowId, NODE_KEYS.BUILD);
    if (!buildKey) throw new Error("expected a build node");
    const ctx = await flowEngine.ctx(flowId);
    const gitBranch = flowCtxHelper.buildBranch(ctx, "b1");
    // the first attempt created the MR on the host, then the process crashed
    // BEFORE the persist transaction — the MR exists, the flow does not know
    const mrNumber = gitHost.addChangeRequest({ sourceBranch: gitBranch });

    const jobs = new JobQueue();
    const { id: jobId } = await jobs.enqueue({
      kind: JOB_KIND.MR_CREATE, flowId,
      dedupKey: mrCreateDedupKey(flowId, "b1"),
      payload: {
        flowId, branchName: "b1", emitNodeKey: buildKey,
        gateKey: null, reviewKey: null, skipGateReviewReset: true, maxCommitFixAttempts: 2,
      },
    });
    expect((await jobs.claimById(jobId))?.id).toBe(jobId);

    // crash window: the lease lapses; the sweep re-claims and dispatches the
    // handler (runFix wired through the engine's delegate, as the poller does)
    await db.run(`UPDATE jobs SET lease_until = now() - interval '1 second' WHERE id=$1`, jobId);
    const processed = await jobs.sweepDue({
      [JOB_KIND.MR_CREATE]: (job) => new MrCreateHandler(flowEngine, jobs, (t, attempt, error) =>
        flowEngine.chain.runBuildCommitFix(t.flowId, t.buildKey, t.branch, attempt, t.maxAttempts, error),
      ).handle(job),
    });
    expect(processed).toBe(1);

    // the adopt path landed the EXISTING MR — no second create on the host
    expect(gitHost.calls.filter((c) => c.kind === "createChangeRequest")).toHaveLength(0);
    const flow = await db.get<{ gitlabProjectId: number | null }>(
      `SELECT gitlab_project_id AS "gitlabProjectId" FROM flows WHERE id=$1`, flowId,
    );
    expect(flow?.gitlabProjectId).toBe(1); // the flows row was updated
    const branch = await db.get<{ mrIid: number | null }>(
      `SELECT mr_iid AS "mrIid" FROM branches WHERE flow_id=$1 AND name='b1'`, flowId,
    );
    expect(branch?.mrIid).toBe(mrNumber);
    const job = await jobRowOf(jobId);
    expect(job.status).toBe("done"); // completed inside the persist transaction
    expect(job.dedupKey).toBeNull();
  }, 15_000);

  test("a CommitError (fix budget exhausted) is a normal terminal: mr-failed event + handback, job done", async () => {
    const flowId = await harness.seedSdlcFlow();
    const buildKey = await flowEngine.keyOfRole(flowId, NODE_KEYS.BUILD);
    if (!buildKey) throw new Error("expected a build node");
    await harness.setNodeForFixture(flowId, buildKey, "approved"); // mrHandback's from-set
    // script the host: every create is a hook rejection (a CommitError)
    const client = (gitHost as unknown as {
      client: { createChangeRequest: () => Promise<never> };
    }).client;
    const realCreate = client.createChangeRequest;
    client.createChangeRequest = () =>
      Promise.reject(new CommitError("push rejected for branch b1", "pre-receive hook declined"));
    try {
      agent.pushRun({ status: "finished", result: "fixed and pushed" }); // the one fix attempt

      const jobs = new JobQueue();
      const { id: jobId, deduplicated } = await jobs.enqueue({
        kind: JOB_KIND.MR_CREATE, flowId,
        dedupKey: mrCreateDedupKey(flowId, "b1"),
        payload: {
          flowId, branchName: "b1", emitNodeKey: buildKey,
          gateKey: null, reviewKey: null, skipGateReviewReset: true, maxCommitFixAttempts: 1,
        },
      });
      expect(deduplicated).toBe(false);
      const job = await jobs.claimById(jobId);
      if (!job) throw new Error("expected the mr_create job to be claimable");
      // a no-op runFix keeps the test on the handler's terminal path (the
      // chain's commit-fix run has its own seam); the wiring through
      // `flowEngine.chain.runBuildCommitFix` is exercised by the re-claim test above
      const handler = new MrCreateHandler(flowEngine, jobs, async () => {});
      await expect(handler.handle(job)).resolves.toBeNull(); // recorded failure, not a crash

      expect(await harness.nodeStatus(flowId, buildKey)).toBe("awaiting_approval"); // mrHandback landed
      const mrFailed = await harness.events(flowId, { type: "mr_failed" });
      expect(mrFailed.length).toBe(1);
      expect(mrFailed[0]?.message).toContain("MR creation failed");
      const row = await jobRowOf(jobId);
      expect(row.status).toBe("done"); // a NORMAL terminal — the outcome is in the feed
      expect(row.dedupKey).toBeNull();
      // the freed key lets a re-approve enqueue a FRESH intent
      const retry = await jobs.enqueue({
        kind: JOB_KIND.MR_CREATE, flowId,
        dedupKey: mrCreateDedupKey(flowId, "b1"),
        payload: { flowId, branchName: "b1", emitNodeKey: buildKey, maxCommitFixAttempts: 1 },
      });
      expect(retry.deduplicated).toBe(false);
    } finally {
      client.createChangeRequest = realCreate;
    }
  }, 15_000);
});
