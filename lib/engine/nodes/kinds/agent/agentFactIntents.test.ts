import { describe, expect, it, vi } from "vitest";
import type { AgentRunResult } from "../../../ports/agentPort";
import { AgentDefSchema } from "../../schemas/declarativeSchemas";
import { agentFactIntents } from "./agentFactIntents";

const cfgOf = (produces: string[]) => AgentDefSchema.parse({ produces });

const runOf = (branches?: string[]): AgentRunResult => ({
  id: "run_test",
  status: "finished",
  result: "# done",
  ...(branches
    ? { git: { branches: branches.map((branch) => ({ branch })) } }
    : {}),
} as AgentRunResult);

const capture = async (branch: string) => ({ raw: `diff ${branch}`, stat: "1 file changed" });

describe("agentFactIntents — local branch fallback", () => {
  it("uses the worktree branch when a producing run reported no git branches", async () => {
    const resolveLocalBranch = vi.fn().mockResolvedValue("bugfix/local-1");
    const captureDiff = vi.fn(capture);

    const intents = await agentFactIntents(runOf(), cfgOf(["branch", "diff"]), captureDiff, { resolveLocalBranch });

    expect(resolveLocalBranch).toHaveBeenCalledTimes(1);
    expect(captureDiff).toHaveBeenCalledWith("bugfix/local-1");
    expect(intents?.branches).toEqual([{ name: "bugfix/local-1", gitBranch: "bugfix/local-1" }]);
    expect(intents?.diffs).toMatchObject([{ branch: "bugfix/local-1", raw: "diff bugfix/local-1" }]);
  });

  it("a reported branch wins — no worktree probe", async () => {
    const resolveLocalBranch = vi.fn().mockResolvedValue("bugfix/local-2");
    const captureDiff = vi.fn(capture);

    const intents = await agentFactIntents(runOf(["changelog/x"]), cfgOf(["diff"]), captureDiff, { resolveLocalBranch });

    expect(resolveLocalBranch).not.toHaveBeenCalled();
    expect(captureDiff).toHaveBeenCalledWith("changelog/x");
    expect(intents?.diffs).toMatchObject([{ branch: "changelog/x" }]);
  });

  it("an undeclared fact kind probes nothing (F4)", async () => {
    const resolveLocalBranch = vi.fn().mockResolvedValue("bugfix/local-3");
    const captureDiff = vi.fn(capture);

    const intents = await agentFactIntents(runOf(), cfgOf([]), captureDiff, { resolveLocalBranch });

    expect(resolveLocalBranch).not.toHaveBeenCalled();
    expect(captureDiff).not.toHaveBeenCalled();
    expect(intents).toBeNull();
  });

  it("a failing worktree probe is non-fatal and establishes no facts", async () => {
    const resolveLocalBranch = vi.fn().mockRejectedValue(new Error("no worktree"));
    const captureDiff = vi.fn(capture);

    const intents = await agentFactIntents(runOf(), cfgOf(["diff"]), captureDiff, { resolveLocalBranch });

    expect(intents).toBeNull();
    expect(captureDiff).not.toHaveBeenCalled();
  });

  it("malformed reported entries fall back to the worktree branch", async () => {
    const resolveLocalBranch = vi.fn().mockResolvedValue("bugfix/local-4");
    const captureDiff = vi.fn(capture);

    const intents = await agentFactIntents(runOf([""]), cfgOf(["diff"]), captureDiff, { resolveLocalBranch });

    expect(resolveLocalBranch).toHaveBeenCalledTimes(1);
    expect(intents?.diffs).toMatchObject([{ branch: "bugfix/local-4" }]);
  });
});
