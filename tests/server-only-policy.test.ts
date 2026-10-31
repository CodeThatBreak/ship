import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CLIENT_SAFE_LIB = new Set([
  "lib/utils.ts",
  "lib/modelSpec.ts",
  "lib/format.ts",
  "lib/usage.ts",
  "lib/groupEvents.ts",
  "lib/eslint-policy-probe.ts",
]);

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "jsonata") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
};

describe("lib server-only marker", () => {
  it("every non-allowlisted lib module imports server-only", () => {
    const libRoot = path.join(repoRoot, "lib");
    const offenders: string[] = [];

    for (const abs of walk(libRoot)) {
      const rel = path.relative(repoRoot, abs).replaceAll("\\", "/");
      if (CLIENT_SAFE_LIB.has(rel) || rel.startsWith("lib/jsonata/")) continue;
      const text = fs.readFileSync(abs, "utf8");
      if (!/import\s["']server-only["']/.test(text)) {
        offenders.push(rel);
      }
    }

    expect(offenders).toEqual([]);
  });
});
