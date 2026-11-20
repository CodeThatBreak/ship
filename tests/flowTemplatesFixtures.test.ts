import { testGet } from "@/tests/helpers/rawTestDb";
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "./helpers/testDatabase";

assignTestDatabase();

const fixtureDir = path.join(process.cwd(), "docs/flow-templates");
const fixturePaths = fs.readdirSync(fixtureDir).filter((f) => f.endsWith(".yaml")).sort();

const { importTemplateYaml } = await import("../lib/engine/templates/templateYaml");
const { templateStore } = await import("../lib/engine/templates/templateStore");

beforeAll(resetTestDatabase);

describe("docs/flow-templates fixtures", () => {
  it.each(fixturePaths)("%s imports cleanly", async (file) => {
    const text = fs.readFileSync(path.join(fixtureDir, file), "utf8");
    const { id } = await importTemplateYaml(templateStore, text, { namePrefix: "fixture-test" });
    expect(id).toMatch(/^tpl_/);

    const pipeline = await testGet<{ trigger: unknown }>(
      `SELECT trigger FROM flow_template_nodes n
       WHERE n.template_id = $1 AND n.node_key = 'pipeline'`,
      id,
    );
    if (!pipeline) return;
    // jsonb columns come back already parsed
    const trig = pipeline.trigger as { wait_for?: string };
    expect(trig.wait_for).toBe("pipeline");
  });

  it("the SDLC loop edge re-enters CI only on a verified push (§6A)", async () => {
    // the seeded template's loop edge — the one value the pipeline/review loop
    // actually gate on
    const seeded = await testGet<{ condition: string }>(
      `SELECT condition FROM flow_template_edges
       WHERE template_id = 'tpl_sdlc_loop' AND from_key = 'resolve' AND kind = 'loop'`,
    );
    expect(seeded?.condition).toBe("nodes.resolve.output.pushed = true");

    // the YAML fixture (test-imported, so this fails the suite when it drifts)
    const yaml = fs.readFileSync(path.join(fixtureDir, "sdlc-loop.yaml"), "utf8");
    expect(yaml).toContain("condition: 'nodes.resolve.output.pushed = true'");
  });
});
