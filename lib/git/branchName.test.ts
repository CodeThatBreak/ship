import { describe, expect, it } from "vitest";
import { assertValidBranchName, InvalidBranchNameError, rejectInvalidBranchNameShape } from "./branchName";

describe("branch name validation", () => {
  it("rejects names that look like git options", () => {
    expect(() => rejectInvalidBranchNameShape("-master")).toThrow(InvalidBranchNameError);
  });

  it("accepts a normal branch through git check-ref-format", async () => {
    await assertValidBranchName("feature/task-60-fix");
  });

  it("rejects invalid ref shapes via git", async () => {
    await expect(assertValidBranchName("bad..branch")).rejects.toBeInstanceOf(InvalidBranchNameError);
  });
});
