import { describe, expect, it } from "vitest";
import type { ChangeRequest, Pipeline } from "../../../ports/git-host";
import { classifyHeadPipeline, shouldDeferPipelineTrigger } from "./pipeline-head";

const cr = (sha: string, headId?: number): ChangeRequest => ({
  id: "1",
  number: 1,
  title: "t",
  state: "opened",
  webUrl: "u",
  sourceBranch: "b",
  targetBranch: "main",
  sha,
  headPipeline: headId ? { id: headId, status: "pending", webUrl: "u" } : null,
  projectId: 1,
});

const pipe = (id: number, sha: string, status = "running"): Pipeline => ({
  id,
  status,
  ref: "b",
  sha,
  webUrl: "u",
});

describe("classifyHeadPipeline", () => {
  it("returns error when the change request fetch failed", () => {
    expect(classifyHeadPipeline(null, true, null, false)).toEqual({ kind: "error" });
  });

  it("returns none when the MR has no head pipeline", () => {
    expect(classifyHeadPipeline(cr("abc"), false, null, false)).toEqual({ kind: "none" });
  });

  it("returns error when the pipeline fetch failed", () => {
    expect(classifyHeadPipeline(cr("abc", 9), false, null, true)).toEqual({ kind: "error" });
  });

  it("returns stale when pipeline sha does not match the MR head", () => {
    expect(classifyHeadPipeline(cr("new", 9), false, pipe(9, "old"), false)).toEqual({ kind: "stale" });
  });

  it("returns ok when pipeline matches MR head", () => {
    const p = pipe(9, "same");
    expect(classifyHeadPipeline(cr("same", 9), false, p, false)).toEqual({ kind: "ok", pipe: p });
  });
});

describe("shouldDeferPipelineTrigger", () => {
  it("defers on API error and during post-fix grace", () => {
    expect(shouldDeferPipelineTrigger({ kind: "error" }, false)).toBe(true);
    expect(shouldDeferPipelineTrigger({ kind: "none" }, true)).toBe(true);
    expect(shouldDeferPipelineTrigger({ kind: "none" }, false)).toBe(false);
  });
});
