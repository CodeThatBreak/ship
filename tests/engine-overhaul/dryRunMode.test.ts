/**
 * Task 27 — the `dry-run` execution mode end to end (design §7, finding D1):
 * a whole-template simulated execution — real graph, real snapshots, real
 * contracts and effects, fake side effects. The flow runs on the PROMOTED
 * dry-run ports (`FakeAgentPort`/`FakeGitHost` registered under the
 * `dry-run` harness key — no test-local fake is registered here), every
 * produced artifact carries the `meta.dryRun` provenance badge flag, the
 * declarative `create_change_request` effect lands on the fake host, and no
 * real MR/pipeline is touched. The reconciler's recovery seam excludes
 * dry-run flows (the harness's runs are in-memory; a restart cannot
 * re-attach), and the poller's MR-duty gate excludes them by mode.
 *
 * Runs against the isolated dockerized Postgres test database (AGENTS.md §1).
 */
import { beforeAll, describe, expect, it } from "vitest";

import { assignTestDatabase, resetTestDatabase } from "../helpers/testDatabase";

// Must run before any `db` import touches the connection — dynamic imports
// below resolve lazily once DATABASE_URL points at the test database.
assignTestDatabase();

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");
const { agentPortRegistry } = await import("@/lib/engine/ports/agentPort");
const { gitHostRegistry } = await import("@/lib/engine/ports/gitHost");
const { HARNESS_KEYS } = await import("@/lib/engine/constants/harnesses");
const { ARTIFACT_META } = await import("@/lib/engine/constants/artifactMeta");
const { RUN_MODE } = await import("@/constants/execution");
const { FLOW_ACTION } = await import("@/constants/flow");
const { testGet, testRun } = await import("@/tests/helpers/rawTestDb");
const { FlowHarness } = await import("@/tests/helpers/flowHarness");
const { RecoveryDriver } = await import("@/lib/engine/runtime/reconcile/recoveryDriver");
const { isRealMrFlow } = await import("@/lib/engine/utils/runMode");
const { POST } = await import("@/app/api/flows/[id]/action/route");
type FlowRow = import("@/lib/db/rows").FlowRow;

let agent: import("@/lib/engine/ports/agentPort/fakeAgentPort").FakeAgentPort;
let git: import("@/lib/engine/ports/gitHost/fakeGitHost").FakeGitHost;
let harness: import("@/tests/helpers/flowHarness").FlowHarness;

beforeAll(async () => {
  await resetTestDatabase();
  // the dry-run built-in ports — resolved by mode, never registered per-test
  agent = (await agentPortRegistry.forMode(RUN_MODE.DRY_RUN)) as import("@/lib/engine/ports/agentPort/fakeAgentPort").FakeAgentPort;
  git = gitHostRegistry.get(HARNESS_KEYS.DRY_RUN) as import("@/lib/engine/ports/gitHost/fakeGitHost").FakeGitHost;
  harness = new FlowHarness({ db, flowEngine, templateStore });
});

const seedDryRunFlow = async (): Promise<string> => {
  const row = await templateStore.createNodeTemplate({
    key: `dry_run_fixture_${Date.now()}`,
    name: "Dry run fixture",
    kind: "agent",
    config: {
      mode: "plan",
      prompt: "Write the changelog",
      output: "markdown",
      produces: ["branch", "diff"],
      effects: { afterApproval: ["create_change_request"] },
    },
  });
  return harness.seedInlineFlow(
    [{ key: "changelog", def: row.id, trigger: { type: "auto" } }],
    [],
    { executionMode: RUN_MODE.DRY_RUN },
  );
};

const callAction = (flowId: string, body: unknown): Promise<Response> =>
  POST(
    new Request(`http://localhost/api/flows/${flowId}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: flowId }) },
  );

const flowModeOf = async (flowId: string): Promise<string | null> => {
  const row = await testGet<{ executionMode: string | null }>(
    `SELECT execution_mode AS "executionMode" FROM flows WHERE id=$1`,
    flowId,
  );
  return row?.executionMode ?? null;
};

const artifactMetaOf = async (flowId: string, kind: string): Promise<Record<string, unknown> | null> => {
  const row = await testGet<{ meta: unknown }>(
    `SELECT a.meta FROM artifacts a JOIN nodes n ON n.id=a.node_id
     WHERE n.flow_id=$1 AND a.kind=$2 ORDER BY a.version DESC LIMIT 1`,
    flowId, kind,
  );
  return row?.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
    ? (row.meta as Record<string, unknown>)
    : null;
};

const gitCreates = () =>
  git.calls.filter(
    (c): c is Extract<import("@/lib/engine/ports/gitHost/types/fakeGitHost").GitHostCall, { kind: "createChangeRequest" }> =>
      c.kind === "createChangeRequest",
  );
describe("dry-run execution mode (task 27 — design §7 D1)", () => {
  it("runs the whole graph on the fake ports, stamps the badge on every artifact, and opens the MR on the fake host", async () => {
    const flowId = await seedDryRunFlow();
    expect(await flowModeOf(flowId)).toBe(RUN_MODE.DRY_RUN);

    // the agent node runs against the dry-run port — the started event names
    // the mode, so the run provably did NOT ride the real cloud runtime
    agent.pushRun({ status: "finished", result: "# changelog (simulated)", git: { branches: [{ branch: "feat/changelog" }] } });
    await flowEngine.startNodeStage(flowId, "changelog");
    expect(await harness.nodeStatus(flowId, "changelog")).toBe("done");
    const started = await harness.events(flowId, { type: "lifecycle" });
    expect(started.some((e) => e.message.includes("started (dry-run)"))).toBe(true);

    // the facts landed in their existing homes: the branch row (the branch
    // fact's `building` status stamp — `recordBranch`) + the diff fact
    const branch = await testGet<{ mr_iid: number | null; status: string }>(
      `SELECT mr_iid, status::text AS status FROM branches WHERE flow_id=$1 AND name='feat/changelog'`,
      flowId,
    );
    expect(branch?.status).toBe("building");

    // the provenance badge flag rides EVERY produced artifact (markdown
    // output + the diff fact) — task 23's renderer badge reads it
    for (const kind of ["markdown", "diff"]) {
      const meta = await artifactMetaOf(flowId, kind);
      expect(meta?.[ARTIFACT_META.DRY_RUN]).toBe(true);
    }

    // the declarative effect runs for real — against the FAKE host only
    const res = await callAction(flowId, { action: FLOW_ACTION.CREATE_CHANGE_REQUEST, nodeKey: "changelog" });
    expect(res.status).toBe(200);
    const creates = gitCreates();
    expect(creates).toHaveLength(1);
    expect(creates[0]?.input.sourceBranch).toContain("feat/changelog");
    const after = await testGet<{ mr_iid: number | null; mr_url: string | null }>(
      `SELECT mr_iid, mr_url FROM branches WHERE flow_id=$1 AND name='feat/changelog'`,
      flowId,
    );
    expect(after?.mr_iid).not.toBeNull();
    expect(after?.mr_url).toBe(git.changeRequests.get(after?.mr_iid ?? 0)?.webUrl ?? null);
  });

  it("the reconciler's recovery seam excludes dry-run flows — no probe of the real agent runtime", async () => {
    const flowId = `flw_dryrecover_${Date.now()}`;
    const nodeId = db.uid("node_");
    await testRun(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      `task_${flowId}`, "jira", "DRY-1", "dry-run recovery", "open", "task", "P2",
    );
    await testRun(
      `INSERT INTO flows (id, task_id, name, status, execution_mode, created_at, updated_at)
       VALUES ($1,$2,'t','active','dry-run',now(),now())`,
      flowId, `task_${flowId}`,
    );
    await testRun(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at)
       VALUES ($1,$2,'changelog','agent','running',now(),now())`,
      nodeId, flowId,
    );
    await testRun(`UPDATE nodes SET lease_until = now() - interval '5 minutes' WHERE id=$1`, nodeId);

    const driver = new RecoveryDriver();
    const row = await testGet<{ id: string; executionMode: string }>(
      `SELECT id, execution_mode AS "executionMode" FROM flows WHERE id=$1`, flowId,
    );
    await driver.recover(row as unknown as FlowRow, { id: nodeId, nodeKey: "changelog" });

    expect(await harness.nodeStatus(flowId, "changelog")).toBe("failed");
    const events = await harness.events(flowId, { type: "error" });
    expect(events.some((e) => e.message.includes("dry-run harness keeps its runs in memory"))).toBe(true);
  });

  it("the poller's MR-duty gate excludes dry-run flows by mode", async () => {
    expect(isRealMrFlow(RUN_MODE.DRY_RUN)).toBe(false);
    expect(isRealMrFlow(RUN_MODE.CLOUD)).toBe(true);
    expect(isRealMrFlow(RUN_MODE.LOCAL)).toBe(true);
    expect(isRealMrFlow(null)).toBe(true);
  });

  it("a `cloud` flow never resolves the simulation ports (the modes stay disjoint)", async () => {
    const cloudPort = await agentPortRegistry.forMode(RUN_MODE.CLOUD);
    expect(cloudPort.kind).not.toBe(HARNESS_KEYS.DRY_RUN);
    // the test db has no real host configured — URL resolution fails loudly
    // rather than landing on the simulation host
    await expect(gitHostRegistry.forRepo(harness.repoUrl, RUN_MODE.CLOUD)).rejects.toThrow(
      /no git host configured/,
    );
  });
});
