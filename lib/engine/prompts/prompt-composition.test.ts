import { describe, expect, it } from "vitest";
import { DEFAULT_PROMPT_TEMPLATES, composeTemplate } from "./prompt-defaults";

const EXPECTED_BODY_ONCE = new Set(["review", "resolve", "pipeline_fix"]);

describe("composeTemplate", () => {
  it("composes every default prompt template without duplicating the body (review family)", () => {
    for (const [key, tpl] of Object.entries(DEFAULT_PROMPT_TEMPLATES)) {
      const composed = composeTemplate(tpl);
      expect(composed.length).toBeGreaterThan(0);
      if (!EXPECTED_BODY_ONCE.has(key)) continue;
      const body = tpl.userTemplate.trim();
      expect((composed.match(new RegExp(escapeRegExp(body), "g")) ?? []).length).toBe(1);
    }
  });
});

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
