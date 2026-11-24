import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEMO_FLOW_PLAN_V1,
  DEMO_FLOW_PLAN_V2,
} from "../scripts/demoPlanFixtures.mjs";
import { PlanResponse, parsePlanArtifactMeta } from "../lib/engine/nodes/kinds/plan/schema";

const script = (name: string) => fs.readFileSync(path.join(process.cwd(), "scripts", name), "utf8");

describe("demo seed plan fixtures (turn-envelope authoring)", () => {
  it("the demo seeds carry no markdown plan-meta fence and no bespoke metaOf parse", () => {
    for (const name of ["seed-demo-flow.mjs"]) {
      const source = script(name);
      expect(source, `${name} still embeds a plan-meta fence`).not.toMatch(/```json plan-meta/);
      expect(source, `${name} still parses meta out of the markdown`).not.toContain("metaOf");
      // the meta comes from the shared fixture module, not an inline regex parse
      expect(source, `${name} does not consume the shared fixture module`).toContain(
        "demoPlanFixtures.mjs",
      );
    }
  });

  it("every fixture meta parses through the real plan artifact meta schema", () => {
    const v1 = parsePlanArtifactMeta(DEMO_FLOW_PLAN_V1.meta);
    expect(v1).not.toBeNull();
    expect(v1?.steps).toHaveLength(7);

    const v2 = parsePlanArtifactMeta(DEMO_FLOW_PLAN_V2.meta);
    expect(v2).not.toBeNull();
    expect(v2?.steps).toHaveLength(8);
  });

  it("every fixture markdown + steps validates against the real PlanResponse contract", () => {
    // unique step ids are the only plan-domain refinement — the same
    // validation a live plan run gets
    for (const fixture of [DEMO_FLOW_PLAN_V1, DEMO_FLOW_PLAN_V2]) {
      expect(() =>
        PlanResponse.parse({
          markdown: fixture.markdown,
          steps: fixture.meta.steps,
        }),
      ).not.toThrow();
    }
  });
});
