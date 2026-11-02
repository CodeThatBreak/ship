import { describe, expect, it } from "vitest";
import { baseRefCandidates, resolveWorktreeBaseRef } from "./baseRef";
import { BaseRefNotFoundError } from "./gitErrors";

describe("resolveWorktreeBaseRef", () => {
  it("does not fall back to HEAD (CR-224)", async () => {
    const tried: string[] = [];
    await expect(
      resolveWorktreeBaseRef(async (ref) => {
        tried.push(ref);
        return ref === "HEAD";
      }, "develop"),
    ).rejects.toBeInstanceOf(BaseRefNotFoundError);
    expect(tried).not.toContain("HEAD");
    expect(tried).toEqual(baseRefCandidates("develop").candidates);
  });

  it("returns the first matching candidate", async () => {
    const resolved = await resolveWorktreeBaseRef(async (ref) => ref === "origin/main", "main");
    expect(resolved).toBe("origin/main");
  });
});
