/**
 * Database facade (Postgres + Prisma, step 01): uid monotonicity, event
 * paging, repo upsert semantics and message threads — against the dockerized
 * test database (vitest globalSetup migrates it; truncated per file).
 */
import { testGet, testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("./app");

const seedFlow = async (flowId: string, taskId: string) => {
  await testRun(
    `INSERT INTO tasks (id,type,fields,key,summary) VALUES ($1,'jira','{}'::jsonb,$2,'s') ON CONFLICT (id) DO NOTHING`,
    taskId,
    taskId.toUpperCase(),
  );
  await testRun(
    `INSERT INTO flows (id,task_id,name,status,created_at,updated_at) VALUES ($1,$2,'n','active',now(),now()) ON CONFLICT (id) DO NOTHING`,
    flowId,
    taskId,
  );
};

describe("Database facade", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });

  it("uid() is strictly increasing within the same mocked millisecond", () => {
    const ms = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => ms);
    const ids = [db.uid("ev_"), db.uid("ev_"), db.uid("ev_")];
    expect(ids[0] < ids[1] && ids[1] < ids[2]).toBe(true);
    vi.restoreAllMocks();
  });

  it("seeds built-in templates", async () => {
    const row = await testGet<{ ok: number }>(
      `SELECT 1 AS ok FROM flow_templates WHERE id='tpl_sdlc_loop'`,
    );
    expect(row).toEqual({ ok: 1 });
  });

  it("listEvents pages with id > after and listEventsTail returns newest window", async () => {
    await seedFlow("flw_ev", "t_ev");
    await testRun(`DELETE FROM events WHERE flow_id=$1`, "flw_ev");
    const ts = "2026-01-01T00:00:00.000Z";
    await testRun(
      `INSERT INTO events (id,flow_id,node_id,type,message,data,created_at) VALUES ($1,$2,NULL,'s','a',NULL,$3)`,
      "ev_a",
      "flw_ev",
      ts,
    );
    await testRun(
      `INSERT INTO events (id,flow_id,node_id,type,message,data,created_at) VALUES ($1,$2,NULL,'s','b',NULL,$3)`,
      "ev_b",
      "flw_ev",
      ts,
    );
    const page = await db.listEvents("flw_ev", "ev_a", 10);
    expect(page.map((r) => r.id)).toEqual(["ev_b"]);
    const tail = await db.listEventsTail("flw_ev", 1);
    expect(tail.map((r) => r.id)).toEqual(["ev_b"]);
  });

  it("upsertRepo throws NotFoundError when updating a missing repo id", async () => {
    await expect(
      db.upsertRepo({
        id: "repo_missing",
        name: "n",
        cloudUrl: "https://gitlab.example.com/group/repo",
      }),
    ).rejects.toThrow(/repo repo_missing not found/);
  });

  it("upsertRepo returns the inserted repo row", async () => {
    const repo = await db.upsertRepo({
      name: "demo",
      cloudUrl: "https://gitlab.example.com/group/demo",
    });
    expect(repo.id).toMatch(/^repo_/);
    expect(repo.name).toBe("demo");
    expect(repo.useWorktrees).toBe(true);
  });

  it("addMessage stores messages.thread from the schema", async () => {
    await seedFlow("flw_1", "t_1");
    await db.addMessage("flw_1", "plan", "user", "refine auth", "auth");
    const row = await testGet<{ thread: string | null }>(
      `SELECT thread FROM messages WHERE flow_id='flw_1' LIMIT 1`,
    );
    expect(row?.thread).toBe("auth");
  });
});
