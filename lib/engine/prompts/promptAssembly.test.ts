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

  it("places prompt_rules between the body and locked blocks", () => {
    const asm = prompts.assemblePrompt("plan", planCtx, extra, { userRules: "MY-STANDING-RULE" });
    expect(asm.final.startsWith(`${asm.body}\n\nMY-STANDING-RULE\n\n`)).toBe(true);
    expect(asm.userRules).toBe("MY-STANDING-RULE");
  });

  it("keeps build verbatim overrides ahead of standing rules", () => {
    const buildFinal = prompts.resolve("build", {}, {}, "MY-VERBATIM-OVERRIDE", { userRules: "MY-STANDING-RULE" });
    expect(buildFinal).toBe("MY-VERBATIM-OVERRIDE\n\nMY-STANDING-RULE");
  });
});
