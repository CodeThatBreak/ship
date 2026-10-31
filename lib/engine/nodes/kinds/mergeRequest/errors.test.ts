import { describe, expect, it } from "vitest";
import { isHookRejection, toMrCreationFailure, CommitError, MrCreationFailed } from "./errors";

describe("merge-request errors", () => {
  it("isHookRejection matches pre-receive hook failures", () => {
    expect(isHookRejection("remote: error: hook declined to update refs/heads/main")).toBe(true);
    expect(isHookRejection("network timeout")).toBe(false);
  });

  it("toMrCreationFailure wraps CommitError only", () => {
    const commitErr = new CommitError("push rejected", "detail");
    const wrapped = toMrCreationFailure(commitErr);
    expect(wrapped).toBeInstanceOf(MrCreationFailed);
    expect((wrapped as MrCreationFailed).cause).toBe(commitErr);
    const plain = toMrCreationFailure(new Error("vpn down"));
    expect(plain).toBeInstanceOf(Error);
    expect(plain).not.toBeInstanceOf(MrCreationFailed);
  });
});
