/**
 * Architecture (schema-scan): Prisma naming convention (decision Q11).
 *
 * Every model field is declared camelCase, and any field whose DB column is
 * snake_case carries an explicit `@map("snake_case")`. Every model maps its
 * table with `@@map("snake_case")`. The DB stays snake_case; TypeScript reads
 * camelCase (`node.nodeKey`). This test is the enforcement point the step doc
 * requires — it must PASS (not test.fails).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const schemaPath = path.join(repoRoot, "prisma/schema.prisma");

const CAMEL = /^[a-z][A-Za-z0-9]*$/;
const SNAKE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

type ModelBlock = { name: string; body: string };

const parseModels = (text: string): ModelBlock[] => {
  const blocks: ModelBlock[] = [];
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    blocks.push({ name: m[1], body: m[2] });
  }
  return blocks;
};

describe("prismaSchemaCasing", () => {
  const text = fs.readFileSync(schemaPath, "utf8");
  const models = parseModels(text);

  it("declares at least the 22 ported tables", () => {
    expect(models.length).toBeGreaterThanOrEqual(22);
  });

  it("every model field is camelCase (relation fields exempt; scalars behind @map)", () => {
    const violations: string[] = [];
    for (const { name, body } of models) {
      for (const line of body.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) continue;
        const fieldMatch = /^(\w+)\s+([\w[\]?!]+)/.exec(trimmed);
        if (!fieldMatch) continue;
        const field = fieldMatch[1];
        const type = fieldMatch[2].replace(/[[\]?!]/g, "");
        // relation fields reference another model — they carry no column
        const isRelation = models.some((m) => m.name === type);
        if (!CAMEL.test(field)) {
          violations.push(`${name}.${field}: field must be camelCase (use @map for the column)`);
        }
        if (isRelation) continue;
        // a camelCase SCALAR field that differs from its column must carry @map
        const hasMap = /@map\("[a-z0-9_]+"\)/.test(trimmed);
        if (CAMEL.test(field) && /[A-Z]/.test(field) && !hasMap) {
          violations.push(`${name}.${field}: camelCase field missing @map("snake_case")`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("every model maps its table with @@map(\"snake_case\")", () => {
    const violations: string[] = [];
    for (const { name, body } of models) {
      const mapMatch = /@@map\("([^"]+)"\)/.exec(body);
      if (!mapMatch) {
        violations.push(`${name}: missing @@map`);
        continue;
      }
      if (!SNAKE.test(mapMatch[1])) {
        violations.push(`${name}: @@map("${mapMatch[1]}") is not snake_case`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("status vocabularies are PG enums (nodes/runs/flows/artifacts, incl. skipped)", () => {
    for (const en of ["node_status", "run_status", "flow_status", "artifact_status"]) {
      expect(text).toContain(`@@map("${en}")`);
    }
    expect(text).toMatch(/SKIPPED\s+@map\("skipped"\)/);
  });
});
