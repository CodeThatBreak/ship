import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assignDatabasePath, createIsolatedDatabasePath } from "./helpers/testDatabase";

assignDatabasePath(createIsolatedDatabasePath("devflow-flow-fixtures-"));

const fixtureDir = path.join(process.cwd(), "docs/flow-templates");
const fixturePaths = fs.readdirSync(fixtureDir).filter((f) => f.endsWith(".yaml")).sort();

const { importTemplateYaml } = await import("../lib/engine/templates/templateYaml");
const { templateStore } = await import("../lib/engine/templates/templateStore");
const { db } = await import("../lib/db/app");

describe("docs/flow-templates fixtures", () => {
  it.each(fixturePaths)("%s imports cleanly", (file) => {
    const text = fs.readFileSync(path.join(fixtureDir, file), "utf8");
    const { id } = importTemplateYaml(templateStore, text, { namePrefix: "fixture-test" });
    expect(id).toMatch(/^tpl_/);

    const pipeline = db.get<{ trigger: string }>(
      `SELECT trigger FROM flow_template_nodes n
       WHERE n.template_id = ? AND n.node_key = 'pipeline'`,
      id,
    );
    if (!pipeline) return;
    const trig = JSON.parse(pipeline.trigger) as { wait_for?: string };
    expect(trig.wait_for).toBe("pipeline");
  });

  it("the SDLC loop edge re-enters CI only on a verified push (§6A)", () => {
    // the seeded template's loop edge — the one value the pipeline/review loop
    // actually gate on
    const seeded = db.get<{ condition: string }>(
      `SELECT condition FROM flow_template_edges
       WHERE template_id = 'tpl_sdlc_loop' AND from_key = 'resolve' AND kind = 'loop'`,
    );
    expect(seeded?.condition).toBe("nodes.resolve.output.pushed = true");

    // the YAML fixture (test-imported, so this fails the suite when it drifts)
    const yaml = fs.readFileSync(path.join(fixtureDir, "sdlc-loop.yaml"), "utf8");
    expect(yaml).toContain("condition: 'nodes.resolve.output.pushed = true'");
  });
});
