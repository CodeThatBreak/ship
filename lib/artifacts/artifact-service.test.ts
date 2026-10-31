import { describe, expect, it } from "vitest";
import { assignDatabasePath, createIsolatedDatabasePath } from "../../tests/helpers/in-memory-db";
import { NotFoundError } from "../errors";
import { ArtifactService } from "./artifact-service";

assignDatabasePath(createIsolatedDatabasePath("devflow-artifacts-"));

const { db } = await import("../db");
const { rows, ArtifactRow } = await import("../db/rows");

const now = () => new Date().toISOString();

describe("ArtifactService", () => {
  it("returns parsed meta via the row mapper", () => {
    db.run(
      `INSERT INTO tasks (id, type, key, summary) VALUES (?,?,?,?)`,
      "task_a",
      "generic",
      "A-1",
      "a",
    );
    db.run(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
      "flw_a",
      "task_a",
      "flow",
      "active",
      now(),
      now(),
    );
    db.run(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?)`,
      "node_a",
      "flw_a",
      "plan",
      "plan",
      "done",
      now(),
      now(),
    );
    db.run(
      `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, meta, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      "art_1",
      "node_a",
      "flw_a",
      "plan",
      1,
      "# plan",
      JSON.stringify({ branch: "main" }),
      "draft",
      now(),
    );

    const service = new ArtifactService();
    const art = service.get("art_1");
    expect(art.meta).toEqual({ branch: "main" });
    expect(rows.get(ArtifactRow, `SELECT * FROM artifacts WHERE id=?`, "art_1")?.meta).toEqual({
      branch: "main",
    });
  });

  it("throws NotFoundError for a missing artifact", () => {
    const service = new ArtifactService();
    expect(() => service.get("art_missing")).toThrow(NotFoundError);
  });

  it("throws RowDecodeError on corrupt meta when fetched directly", async () => {
    const { RowDecodeError } = await import("../db/row-decode-error");
    db.run(
      `INSERT INTO tasks (id, type, key, summary) VALUES (?,?,?,?)`,
      "task_b",
      "generic",
      "B-1",
      "b",
    );
    db.run(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
      "flw_b",
      "task_b",
      "flow",
      "active",
      now(),
      now(),
    );
    db.run(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?)`,
      "node_b",
      "flw_b",
      "plan",
      "plan",
      "done",
      now(),
      now(),
    );
    db.run(
      `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, meta, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      "art_bad",
      "node_b",
      "flw_b",
      "plan",
      1,
      "x",
      "{not-json",
      "draft",
      now(),
    );
    const service = new ArtifactService();
    expect(() => service.get("art_bad")).toThrow(RowDecodeError);
  });
});
