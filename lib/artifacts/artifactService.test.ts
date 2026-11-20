import { testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../tests/helpers/testDatabase";
import { NotFoundError } from "../errors";
import { ArtifactService } from "./artifactService";

assignTestDatabase();

const { db } = await import("../db/app");
const { ArtifactRow } = await import("../db/rows");
const { parseRow } = await import("@/lib/db/ormRowHelpers");

const now = () => new Date().toISOString();

describe("ArtifactService", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });

  it("returns parsed meta via the row mapper", async () => {
    await testRun(
      `INSERT INTO tasks (id, type, key, summary) VALUES ($1,$2,$3,$4)`,
      "task_a",
      "generic",
      "A-1",
      "a",
    );
    await testRun(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      "flw_a",
      "task_a",
      "flow",
      "active",
      now(),
      now(),
    );
    await testRun(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      "node_a",
      "flw_a",
      "plan",
      "plan",
      "done",
      now(),
      now(),
    );
    // JSONB column: bind the payload object directly (no JSON.stringify)
    await testRun(
      `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, meta, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      "art_1",
      "node_a",
      "flw_a",
      "plan",
      1,
      "# plan",
      { branch: "main" },
      "draft",
      now(),
    );

    const service = new ArtifactService();
    const art = await service.get("art_1");
    expect(art.meta).toEqual({ branch: "main" });
    // the ORM read narrows `artifacts.meta` through the ArtifactRow schema
    const row = await db.prisma.artifact.findUnique({ where: { id: "art_1" } });
    expect(row ? parseRow(ArtifactRow, row, "artifact art_1").meta : undefined).toEqual({ branch: "main" });
  });

  it("throws NotFoundError for a missing artifact", async () => {
    const service = new ArtifactService();
    await expect(service.get("art_missing")).rejects.toThrow(NotFoundError);
  });

  it("throws RowDecodeError on corrupt meta when fetched directly", async () => {
    const { RowDecodeError } = await import("../db/rowDecodeError");
    await testRun(
      `INSERT INTO tasks (id, type, key, summary) VALUES ($1,$2,$3,$4)`,
      "task_b",
      "generic",
      "B-1",
      "b",
    );
    await testRun(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      "flw_b",
      "task_b",
      "flow",
      "active",
      now(),
      now(),
    );
    await testRun(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      "node_b",
      "flw_b",
      "plan",
      "plan",
      "done",
      now(),
      now(),
    );
    await testRun(
      `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, meta, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      "art_bad",
      "node_b",
      "flw_b",
      "plan",
      1,
      "x",
      // JSONB column: non-JSON text cannot be stored at all — the corrupt
      // shape here is a JSON scalar where the mapper requires an object
      JSON.stringify("not-an-object"),
      "draft",
      now(),
    );
    const service = new ArtifactService();
    await expect(service.get("art_bad")).rejects.toThrow(RowDecodeError);
  });
});
