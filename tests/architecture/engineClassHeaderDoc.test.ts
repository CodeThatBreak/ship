/**
 * Architecture (source-scan): every class exported from `lib/engine/**` carries
 * a JSDoc header block directly above its `export class` line (engine overhaul
 * §12 — "every class explains itself": role in the mental model, the
 * invariant(s) it upholds, what it must never do).
 *
 * The gate is zero-tolerance: lib/engine is fully converted, so violations = []
 * is the only passing state. Scans the source text — static gate, not runtime.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ENGINE_ROOT = path.join(repoRoot, "lib/engine");

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
};

const undocumented = (): string[] => {
  const found: string[] = [];
  for (const abs of walk(ENGINE_ROOT)) {
    const rel = path.relative(repoRoot, abs).replaceAll("\\", "/");
    const lines = fs.readFileSync(abs, "utf8").split("\n");
    for (const [index, line] of lines.entries()) {
      if (!/^export\s+(?:abstract\s+)?class\s+\w+/.test(line)) continue;
      // Walk up past blank lines; the first non-blank line must close a JSDoc
      // block (`*/`) — the header doc sits directly on the class declaration.
      let header = index - 1;
      while (header >= 0 && lines[header].trim() === "") header -= 1;
      const prev = (lines[header] ?? "").trimEnd();
      if (!prev.endsWith("*/")) {
        found.push(`${rel}:${index + 1}`);
      }
    }
  }
  return found.sort();
};

describe("engineClassHeaderDoc", () => {
  it("every exported class in lib/engine/** has a JSDoc header doc directly above it", () => {
    expect(undocumented()).toEqual([]);
  });
});
