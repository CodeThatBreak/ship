import { describe, expect, it } from "vitest";
import { prompts } from "./promptLibrary";

describe("prompt assembly", () => {
  const planCtx = { ticket: "TICKET-CTX", ticket_type: "bug" };
  const extra = { context: "## Context\nCONTEXT-BLOCK" };

  it("keeps review instructions from being duplicated mid-prompt", () => {
    const reviewFinal = prompts.resolve(
      "review",
      { ticket_key: "T-1", ticket_type: "bug" },
      { instructions: "INSTRUCTIONS-BODY", diff: "DIFF-BLOCK" },
    );
    expect((reviewFinal.match(/INSTRUCTIONS-BODY/g) ?? []).length).toBe(1);
    expect(reviewFinal.startsWith("INSTRUCTIONS-BODY\n\n")).toBe(true);
  });

  it("build verbatim overrides ride through untouched", () => {
    const buildFinal = prompts.resolve("build", {}, {}, "MY-VERBATIM-OVERRIDE");
    expect(buildFinal).toBe("MY-VERBATIM-OVERRIDE");
  });
});
