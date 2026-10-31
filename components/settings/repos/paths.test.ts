import { describe, expect, it } from "vitest";
import { tildePath } from "./paths";

describe("tildePath", () => {
  const home = "/Users/dev";

  it("collapses paths under the given home directory", () => {
    expect(tildePath("/Users/dev/work/repo", home)).toBe("~/work/repo");
    expect(tildePath("/Users/dev", home)).toBe("~");
  });

  it("leaves paths outside home unchanged", () => {
    expect(tildePath("/Users/Shared/repos/api", home)).toBe("/Users/Shared/repos/api");
    expect(tildePath("/home/ci/api", home)).toBe("/home/ci/api");
  });

  it("returns the path unchanged when home is empty", () => {
    expect(tildePath("/Users/dev/x", "")).toBe("/Users/dev/x");
  });
});
