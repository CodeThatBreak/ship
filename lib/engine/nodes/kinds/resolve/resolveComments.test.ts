import { describe, expect, it } from "vitest";
import { countHostResolved, shouldResolveCommentsOnHost } from "./resolveComments";

describe("resolve comment finalize policy", () => {
  it("only resolves on the host when code changed and comments were open", () => {
    expect(shouldResolveCommentsOnHost(2, true)).toBe(true);
    expect(shouldResolveCommentsOnHost(2, false)).toBe(false);
    expect(shouldResolveCommentsOnHost(0, true)).toBe(false);
  });

  it("counts host successes", () => {
    expect(
      countHostResolved([
        { commentId: "a", ok: true },
        { commentId: "b", ok: false },
      ]),
    ).toBe(1);
  });
});
