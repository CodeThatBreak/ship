/**
 * Architecture (source-scan, decision Q9): `processSingleton` survives ONLY
 * in the DB client (`lib/db/prismaClient.ts` — Prisma's connection pool,
 * pinned inline on `globalThis` for HMR safety). Every other service is
 * either a plain module const (stateless / DB-fenced) or pinned through the
 * process-services container (`lib/composition/processServices.ts`) — none
 * of them may call the `processSingleton` helper, which no longer exists.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LIB_ROOT = path.join(repoRoot, "lib");

/** The only sanctioned process-pinned service (Q9): the Prisma client. */
const ALLOWED = "lib/db/prismaClient.ts";

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
};

const offenders = (): string[] => {
  const found: string[] = [];
  for (const abs of walk(LIB_ROOT)) {
    const rel = path.relative(repoRoot, abs).replaceAll("\\", "/");
    if (rel === ALLOWED) continue;
    const text = fs.readFileSync(abs, "utf8");
    if (/processSingleton\(/.test(text)) found.push(rel);
  }
  return found.sort();
};

describe("noProcessSingletonOutsideDb", () => {
  it("no processSingleton outside the DB client", () => {
    expect(offenders()).toEqual([]);
  });
});
