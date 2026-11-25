import { describe, expect, it, vi } from "vitest";
import type { NodeRow } from "../../../../db/rows";
import type { AgentRunner } from "../../../harness/harnessExports";
import type { GitHostResolver } from "../../../ports/gitHost";
import type { FlowContextHelper } from "../../shared/runContext/flowContextHelper";
import type { FlowCtx } from "../../shared/nodeSharedExports";
import type { NodeSupport } from "../../shared/nodeSupport";
import { PipelineInput } from "./schema";

await import("../../registry");
const { GateFixRunner } = await import("./gateFixRunner");

const ctx = {
  flow: { id: "flow_1", repoUrl: "https://git.example.com/repo.git", executionMode: "cloud" },
  task: { key: "T-1" },
} as unknown as FlowCtx;

const node = { id: "node_1", nodeKey: "pipeline" } as unknown as NodeRow;

const makeRunner = (usage?: { model: string; inputTokens: number; outputTokens: number; costCents: number }) => ({
  executeRun: vi.fn().mockResolvedValue({
    result: { status: "finished", result: "fixed the pipeline" },
    runRowId: "run_1",
    ...(usage ? { usage } : {}),
  }),
  startAgent: vi.fn(),
}) as unknown as AgentRunner;

const makeSupport = () => {
  const tx = {};
  const saved: { kind: string; content: string; meta?: unknown; tx: unknown }[] = [];
  const support = {
    emit: vi.fn().mockResolvedValue(undefined),
    emitLifecycle: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    saveArtifact: vi.fn(async (
      _nodeId: string,
      _flowId: string,
      kind: string,
      content: string,
      meta?: unknown,
      _status?: string,
      tx?: unknown,
    ) => {
      saved.push({ kind, content, meta, tx });
      return { id: `art_${saved.length}`, version: saved.length };
    }),
  } as unknown as NodeSupport;
  return { support, saved, tx };
};

const makeGitHosts = () => ({
  forRepo: vi.fn().mockResolvedValue({
    listPipelineJobs: vi.fn().mockResolvedValue([
      { id: 10, name: "test", status: "failed", manual: false },
    ]),
    getJobTrace: vi.fn().mockResolvedValue("test failed"),
  }),
}) as unknown as GitHostResolver;

const fixArgs = {
  ctx,
  node,
  input: PipelineInput.parse({ prompt: "Fix the failing pipeline" }),
  pipelineId: 42,
  mrBranch: "fix/pipeline",
  attempt: 1,
  maxFixAttempts: 3,
  label: "pipeline",
};

describe("GateFixRunner usage artifacts", () => {
  it("persists fix output and usage in the same transaction", async () => {
    const { support, saved, tx } = makeSupport();
    const runner = makeRunner({
      model: "claude-sonnet-4",
      inputTokens: 500,
      outputTokens: 100,
      costCents: 4,
    });
    const gate = new GateFixRunner(
      support,
      runner,
      { execMode: () => "cloud" } as unknown as FlowContextHelper,
      makeGitHosts(),
    );

    await gate.fix(fixArgs);

    expect(saved.map((artifact) => artifact.kind)).toEqual(["fix", "usage"]);
    expect(saved[0]).toMatchObject({
      content: "fixed the pipeline",
      meta: { pipelineId: 42, attempt: 1 },
      tx,
    });
    expect(saved[1]).toMatchObject({ tx });
    expect(JSON.parse(saved[1]?.content ?? "{}")).toEqual({
      model: "claude-sonnet-4",
      inputTokens: 500,
      outputTokens: 100,
      costCents: 4,
    });
  });

  it("does not create a usage artifact for a duration-only capture", async () => {
    const { support, saved } = makeSupport();
    const gate = new GateFixRunner(
      support,
      makeRunner(),
      { execMode: () => "cloud" } as unknown as FlowContextHelper,
      makeGitHosts(),
    );

    await gate.fix(fixArgs);

    expect(saved.map((artifact) => artifact.kind)).toEqual(["fix"]);
  });
});
