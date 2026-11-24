import { describe, expect, it } from "vitest";

import { DEFAULT_PROMPT_TEMPLATES, composeTemplate } from "./promptDefaults";
import { AgentOutputError } from "../nodes/shared/agent/outputError/outputErrorExports";
import { PLAN_TURN_OUTPUT_JSON_SCHEMA } from "../nodes/kinds/plan/schema";
import { REVIEW_COMMENTS_JSON_SCHEMA } from "../nodes/kinds/review/schema";

/** The contract block(s) of one template, joined the way the assembly does. */
const contractBlock = (key: string): string =>
  DEFAULT_PROMPT_TEMPLATES[key].internalBlocks
    .filter((b) => b.kind === "contract")
    .map((b) => b.text)
    .join("\n\n");

describe("schema-generated output directives (step 05 prompt audit)", () => {
  it("the plan first-turn contract block IS the retry directive — byte-equal, schema-generated", () => {
    // the plan retry prompt (PlanOutputContract.turnRetryPrompt) appends
    // exactly AgentOutputError.directive(PLAN_TURN_OUTPUT_JSON_SCHEMA); the
    // first turn must advertise the same bytes, so the contract block is
    // that directive verbatim (modulo the library's block normalization)
    const expected = AgentOutputError.directive(PLAN_TURN_OUTPUT_JSON_SCHEMA);
    expect(contractBlock("plan").trim()).toBe(expected.trim());
    expect(contractBlock("plan_refine").trim()).toBe(expected.trim());
  });

  it("every plan-family template carries the generated directive in its composed prompt", () => {
    const directive = AgentOutputError.directive(PLAN_TURN_OUTPUT_JSON_SCHEMA).trim();
    for (const key of ["plan", "plan_refine"]) {
      expect(composeTemplate(DEFAULT_PROMPT_TEMPLATES[key])).toContain(directive);
    }
  });

  it("the plan templates no longer hand-author the JSON-object prose", () => {
    for (const key of ["plan", "plan_refine"]) {
      expect(composeTemplate(DEFAULT_PROMPT_TEMPLATES[key])).not.toContain(
        "Return a single JSON object ONLY",
      );
      expect(composeTemplate(DEFAULT_PROMPT_TEMPLATES[key])).not.toContain(
        "your entire response must be parseable as a single JSON object",
      );
    }
  });

  it("the review contract advertises the comment array through the generated directive", () => {
    const contract = contractBlock("review");
    expect(contract).toContain(AgentOutputError.directive(REVIEW_COMMENTS_JSON_SCHEMA, "array").trim());
    expect(contract).toContain("one JSON array");
    expect(contract).not.toContain("Return a JSON array ONLY");
  });

  it("the array shape changes only the JSON noun — object directives keep their frozen bytes", () => {
    const schema = { type: "object", required: ["choice"] };
    expect(AgentOutputError.directive(schema)).toContain("one JSON object");
    expect(AgentOutputError.directive(schema, "array")).toContain("one JSON array");
    // only the noun differs; the schema block and envelope instruction are shared
    const objectDirective = AgentOutputError.directive(schema);
    const arrayDirective = AgentOutputError.directive(schema, "array");
    expect(objectDirective.replace("one JSON object", "one JSON array")).toBe(arrayDirective);
  });

  it("the never-resolved commit_fix template is gone", () => {
    expect(Object.keys(DEFAULT_PROMPT_TEMPLATES)).not.toContain("commit_fix");
  });
});
