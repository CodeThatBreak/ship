/**
 * The contracts API's declarative-def contract: the four declarative kinds
 * (agent/http/script/decision) resolve their node_templates row through
 * `instantiateDeclarative`. The kind registrations live behind side-effect
 * imports (`declarativeWiring`, pulled in by `declarativeBootstrap`) — the
 * contract service must import the bootstrap itself, or every declarative
 * def resolves as "unknown node type" (the route never imports flowEngine).
 *
 * Runs against the dockerized Postgres test database (vitest globalSetup
 * migrates it; `resetTestDatabase` truncates + re-seeds per file — AGENTS.md
 * §1 — never a real database).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../tests/helpers/testDatabase";

assignTestDatabase();

const { templateStore } = await import("@/lib/engine/templates/templateStore");
const { contractService } = await import("./contractService");
const { DECLARATIVE_KINDS } = await import("@/lib/engine/nodes/declarativeRegistry");

/** Minimal valid defs — one per declarative kind (schemas in declarativeSchemas.ts). */
const MIN_CONFIG: Record<string, Record<string, unknown>> = {
  agent: { prompt: "inspect the repo", mode: "plan", output: "markdown" },
  http: { url: "https://example.com", method: "GET" },
  script: { runtime: "shell", script: "echo hi" },
  decision: { choices: [{ label: "yes" }] },
};

describe("ContractService.resolve — declarative defs", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });

  it("resolves every declarative kind by its node_templates row id (200)", async () => {
    for (const kind of DECLARATIVE_KINDS) {
      const row = await templateStore.createNodeTemplate({
        name: `contract test ${kind}`,
        kind,
        config: MIN_CONFIG[kind] ?? {},
      });
      const res = await contractService.resolve({ def: row.id });
      expect(res.status, `${kind} (${row.id})`).toBe(200);
      const body = (await res.json()) as { kind: string; key: string };
      expect(body.kind).toBe(kind);
      expect(body.key).toBe(row.id);
    }
  });

  it("resolves a draft def by kind param without a stored row (200)", async () => {
    const res = await contractService.resolve({ kind: "agent", config: { prompt: "hi" } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { kind: string }).kind).toBe("agent");
  });

  it("keeps 404 unknown-node-type for a def with no row", async () => {
    const res = await contractService.resolve({ def: "nt_missing" });
    expect(res.status).toBe(404);
  });
});
