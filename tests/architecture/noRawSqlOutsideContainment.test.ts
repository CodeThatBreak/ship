/**
 * Architecture (source-scan, `noProcessSingletonOutsideDb.test.ts` pattern):
 * raw SQL survives ONLY inside the containment allowlist
 * (`eslint/rawSqlContainment.mjs` — shared with the ESLint ratchet), each
 * entry justified by a Postgres invariant the Prisma query API cannot express
 * (SKIP LOCKED claims, DB-clock interval arithmetic, attempt-fenced CAS,
 * advisory locks, COALESCE partial updates).
 *
 * ORM-first (AGENTS.md §0, decision Q1): any NEW raw statement elsewhere in
 * `lib/` fails this suite — the raw SQL → ORM migration cannot silently
 * regress. See docs/orm-migration/README.md ("Containment record").
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RAW_SQL_CONTAINMENT } from "../../eslint/rawSqlContainment.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LIB_ROOT = path.join(repoRoot, "lib");

/** Allowlist entries are repo-root-relative posix paths. */
const ALLOWLIST = new Set(RAW_SQL_CONTAINMENT);

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

/**
 * The raw shapes the scan looks for. Each pattern requires the *call* shape
 * (paren / backtick adjacency) so doc-comment prose like "`$queryRaw*`" does
 * not false-positive. `sample`/`nonSample` pin the matcher's effectiveness in
 * the self-check below.
 */
const RAW_MARKERS: { name: string; pattern: RegExp; sample: string; nonSample?: string }[] = [
  {
    name: "$queryRawUnsafe(…)",
    pattern: /\$queryRawUnsafe\s*(?:<[\s\S]{0,120}?>\s*)?\(/,
    sample: 'await db.prisma.$queryRawUnsafe<Row[]>("SELECT 1")',
    nonSample: "the header says $queryRawUnsafe is contained",
  },
  {
    name: "$executeRawUnsafe(…)",
    pattern: /\$executeRawUnsafe\s*(?:<[\s\S]{0,120}?>\s*)?\(/,
    sample: 'await db.prisma.$executeRawUnsafe<Row[]>("UPDATE t SET x = $1", 1)',
    nonSample: "the header says $executeRawUnsafe is contained",
  },
  {
    name: "$queryRaw`…` tagged template",
    pattern: /\$queryRaw(?!\w)(?!\*)\s*(?:<[\s\S]{0,120}?>\s*)?`/,
    sample: "await prisma.$queryRaw<Row[]>`SELECT 1`",
    nonSample: "the header says `$queryRaw*`/`$executeRaw*` are contained",
  },
  {
    name: "$executeRaw`…` tagged template",
    pattern: /\$executeRaw(?!\w)(?!\*)\s*(?:<[\s\S]{0,120}?>\s*)?`/,
    sample: "await prisma.$executeRaw`UPDATE t SET x = ${x}`",
  },
  {
    name: "pg client.query(…)",
    pattern: /\bclient\.query\s*[<(]/,
    sample: 'await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1)")',
  },
  {
    name: "db.get(`…`)",
    pattern: /\bdb\.get\s*\(\s*`/,
    sample: "db.get(`SELECT * FROM t`)",
  },
  {
    name: "db.run(`…`)",
    pattern: /\bdb\.run\s*\(\s*`/,
    sample: "db.run(`UPDATE t SET x = 1`)",
  },
  {
    name: "db.all(`…`)",
    pattern: /\bdb\.all\s*\(\s*`/,
    sample: "db.all(`SELECT * FROM t`)",
  },
];

/** The deleted `db.get/all/run` choke-point shapes — must stay at zero everywhere. */
const DELETED_HELPER_MARKERS = RAW_MARKERS.filter((marker) => marker.name.startsWith("db."));

type Match = { file: string; marker: string };

const scanLib = (): Match[] => {
  const found: Match[] = [];
  for (const abs of walk(LIB_ROOT)) {
    const rel = path.relative(repoRoot, abs).replaceAll("\\", "/");
    const text = fs.readFileSync(abs, "utf8");
    for (const marker of RAW_MARKERS) {
      if (marker.pattern.test(text)) found.push({ file: rel, marker: marker.name });
    }
  }
  return found;
};

describe("noRawSqlOutsideContainment", () => {
  it("no raw SQL outside the containment allowlist", () => {
    const offenders = scanLib().filter((match) => !ALLOWLIST.has(match.file));
    expect(
      offenders.map(({ file, marker }) => `${file}: ${marker}`),
    ).toEqual([]);
  });

  it("the deleted db.get/db.run/db.all helpers stay deleted", () => {
    const matches = scanLib().filter((match) =>
      DELETED_HELPER_MARKERS.some((marker) => marker.name === match.marker)
    );
    expect(matches).toEqual([]);
  });

  it("every allowlisted file exists and still carries its raw site", () => {
    const matchesByFile = new Map<string, string[]>();
    for (const { file, marker } of scanLib()) {
      matchesByFile.set(file, [...(matchesByFile.get(file) ?? []), marker]);
    }
    for (const rel of ALLOWLIST) {
      expect(fs.existsSync(path.join(repoRoot, rel)), `allowlist entry missing: ${rel}`).toBe(true);
      expect(
        matchesByFile.get(rel),
        `allowlist entry no longer matches any raw marker — drop it: ${rel}`,
      ).toBeDefined();
    }
  });

  it("the scan's markers match raw shapes (no-op guard)", () => {
    for (const { name, pattern, sample, nonSample } of RAW_MARKERS) {
      expect(pattern.test(sample), `marker cannot catch its own shape: ${name}`).toBe(true);
      if (nonSample) {
        expect(pattern.test(nonSample), `marker false-positives on prose: ${name}`).toBe(false);
      }
    }
  });
});
