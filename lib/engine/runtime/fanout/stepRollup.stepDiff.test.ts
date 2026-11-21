/**
 * Per-step diff facts in the fan-out rollup (task 25, use case 8b): alongside
 * the parent-attached merged diff (`meta.fanout`, vs the integration base)
 * the rollup captures each code step's OWN diff (`makeDiff` on the step
 * branch, keyed by the step's branch row) and the aggregate entry carries the
 * per-step artifact id for the step card.
 *
 * Ordering (the F2 proof): both captures run BEFORE the rollup batch — git
 * never joins a transaction; the merge-back itself runs inside mergeArena's
 * dedicated clone and never rewrites the step branch, so the per-step capture
 * reads the branch's pre-merge content.
 *
 * Runs against the isolated dockerized Postgres test database
 * (AGENTS.md §1 — never a demo/real DB).
 */
import { testAll } from "@/tests/helpers/rawTestDb";
import { beforeAll, afterEach, describe, expect, test, vi } from "vitest";
import type { StepRollup } from "@/lib/engine/runtime/fanout/stepRollup";
import type { StepState } from "@/lib/engine/runtime/fanout/types/stepState";
import type { DiffCapture } from "@/lib/engine/facts/types/facts";
import type { FlowCtx } from "@/lib/engine/nodes/shared/nodeSharedExports";
import { assignTestDatabase, resetTestDatabase } from "@/tests/helpers/testDatabase";
import { FlowHarness } from "@/tests/helpers/flowHarness";
import { expectTransitionsDeclared } from "@/tests/helpers/transitionLogAssert";

assignTestDatabase();

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { stepFlows } = await import("@/lib/engine/runtime/fanout/stepFlowManager");
const { templateStore } = await import("@/lib/engine/templates/templateStore");
const { flowCtxHelper } = await import("@/lib/engine/nodes/shared/runContext");

/** the aggregate publish moved off FlowEngine into the fan-out runtime's
 *  StepRollup (step 07) — tests drive it through the bound facade's rollup */
const rollup = (stepFlows as unknown as { rollup: StepRollup }).rollup;

const harness = new FlowHarness({ db, flowEngine, templateStore });

beforeAll(resetTestDatabase);

const makeDiffSpy = vi.spyOn(flowCtxHelper, "makeDiff");
afterEach(() => {
  makeDiffSpy.mockReset();
});

const INTEGRATION_BRANCH = "bugfix/ovh-25";
const STEP_BRANCH = `${INTEGRATION_BRANCH}-s1`;
const STEP_ID = "OVH-25-1";

/** One resolved code step (merged): its branch row is the per-step fact's key. */
const mergedCodeStep = (): StepState => ({
  step: {
    id: "ps_25",
    flowId: "flw_parent",
    artifactId: null,
    metaId: STEP_ID,
    position: 0,
    title: "Step one",
    detail: null,
    files: "[]",
    branch: STEP_BRANCH,
    status: "done",
    origin: "agent",
    completedBy: "merge",
    subFlowId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  childFlowId: "flw_child_25",
  childStatus: "done",
  childNodeKey: "build",
  childNodeType: "build",
  childNodeStatus: "done",
  branch: STEP_BRANCH,
  integrationBranch: INTEGRATION_BRANCH,
  isCodeChild: true,
  isRunning: false,
  isAwaiting: false,
  isResolved: true,
  isFailed: false,
  mergeStatus: "merged",
  mergeAttempts: 1,
  mergeError: null,
  staleBase: false,
});

/** Seed a fan-out parent flow (running node) — `parentNode` picks the def:
 *  `step_build` carries `mergeBack` (the merged capture's gate; built-in
 *  instances must use the def's own key), `build` is the standard SDLC
 *  fan-out parent. Returns the flow id + the parent node key. */
const seedFanoutParent = async (parentNode: string): Promise<{ flowId: string; nodeKey: string }> => {
  const nodeKey = parentNode;
  const yaml = `
name: Fanout per-step diff
trigger:
  type: manual
nodes:
  - key: ${nodeKey}
    type: builtin/${parentNode}
edges: []
`;
  const { importTemplateYaml } = await import("@/lib/engine/templates/templateYaml");
  const { id: templateId } = await importTemplateYaml(templateStore, yaml, {
    namePrefix: "fanout-step-diff",
  });
  const flowId = await harness.seedFlowFromTemplate(templateId);
  await harness.claimNode(flowId, nodeKey, "runFromPending");
  return { flowId, nodeKey };
};

const diffArtifactsOf = async (flowId: string): Promise<{ id: string; version: number; content: string; meta: Record<string, unknown> }[]> =>
  testAll(
    `SELECT id, version, content, meta FROM artifacts WHERE flow_id=$1 AND kind='diff' ORDER BY version`,
    flowId,
  );

describe("fan-out rollup per-step diff facts (task 25)", () => {
  test("a fanned-out run persists one merged diff (parent) + one per-step diff, and the aggregate entry carries the step's artifact", async () => {
    const { flowId, nodeKey } = await seedFanoutParent("step_build"); // the def carrying `mergeBack`
    makeDiffSpy.mockImplementation(async (_ctx: FlowCtx, branch: string): Promise<DiffCapture> =>
      branch === INTEGRATION_BRANCH
        ? { files: [], stat: "3 files changed", raw: "MERGED DIFF", baseSha: null, headSha: "sha_merged_head", attribution: "all" }
        : { files: [], stat: "1 file changed", raw: "STEP DIFF", baseSha: "sha_step_base", headSha: "sha_step_head", attribution: "agent" },
    );

    await rollup.onAllResolved(flowId, nodeKey, [mergedCodeStep()]);

    expect(await harness.nodeStatus(flowId, nodeKey)).toBe("done");

    const diffs = await diffArtifactsOf(flowId);
    expect(diffs).toHaveLength(2);
    const merged = diffs.find((a) => a.meta.fanout === true);
    const perStep = diffs.find((a) => a.meta.fanout !== true);
    expect(merged).toMatchObject({
      content: "MERGED DIFF",
      meta: { branch: INTEGRATION_BRANCH, stat: "3 files changed" },
    });
    expect(perStep).toMatchObject({
      content: "STEP DIFF",
      meta: {
        branch: STEP_BRANCH,
        stat: "1 file changed",
        baseSha: "sha_step_base",
        headSha: "sha_step_head",
        attribution: "agent",
      },
    });

    // the aggregate entry carries the per-step artifact id (the step card's data path)
    const output = await harness.nodeOutput(flowId, nodeKey);
    const stepEntry = (output?.steps as { id: string; diff_artifact?: string }[])[0];
    expect(stepEntry).toMatchObject({ id: STEP_ID, diff_artifact: perStep?.id });

    expectTransitionsDeclared(flowEngine.transitions, flowId);
  });

  test("the standard SDLC fan-out parent (build, no mergeBack) still publishes the per-step diff fact", async () => {
    const { flowId, nodeKey } = await seedFanoutParent("build");
    makeDiffSpy.mockImplementation(async (_ctx: FlowCtx, branch: string): Promise<DiffCapture> =>
      branch === INTEGRATION_BRANCH
        ? { files: [], stat: "3 files changed", raw: "MERGED DIFF", baseSha: null, headSha: "sha_merged_head", attribution: "all" }
        : { files: [], stat: "1 file changed", raw: "STEP DIFF", baseSha: "sha_step_base", headSha: "sha_step_head", attribution: "agent" },
    );

    await rollup.onAllResolved(flowId, nodeKey, [mergedCodeStep()]);

    expect(await harness.nodeStatus(flowId, nodeKey)).toBe("done");
    // only the per-step fact — the merged capture's parent-def gate is untouched
    const diffs = await diffArtifactsOf(flowId);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ content: "STEP DIFF", meta: { branch: STEP_BRANCH, baseSha: "sha_step_base" } });
    const output = await harness.nodeOutput(flowId, nodeKey);
    const stepEntry = (output?.steps as { id: string; diff_artifact?: string }[])[0];
    expect(stepEntry?.diff_artifact).toBe(diffs[0]?.id);

    expectTransitionsDeclared(flowEngine.transitions, flowId);
  });

  test("a non-code child gets no per-step diff fact (no step branch to key it)", async () => {
    const { flowId, nodeKey } = await seedFanoutParent("build");
    makeDiffSpy.mockImplementation(async (): Promise<DiffCapture> => ({
      files: [], stat: "1 file changed", raw: "STEP DIFF", baseSha: null, headSha: "sha_x", attribution: "all",
    }));

    const step = mergedCodeStep();
    await rollup.onAllResolved(flowId, nodeKey, [{
      ...step,
      isCodeChild: false,
      integrationBranch: null,
      step: { ...step.step, completedBy: "approved" },
    }]);

    expect(await diffArtifactsOf(flowId)).toEqual([]);
    expectTransitionsDeclared(flowEngine.transitions, flowId);
  });
});
