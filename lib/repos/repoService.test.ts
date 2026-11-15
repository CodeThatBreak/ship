import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { assignTestDatabase, resetTestDatabase } from "../../tests/helpers/testDatabase";
import { RepoService } from "./repoService";

assignTestDatabase();

const { db } = await import("../db/app");

describe("RepoService", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });

  it("rejects paths that are not git checkouts", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-nogit-"));
    const service = new RepoService(db);
    expect(() => service.assertGitCheckout(tmp)).toThrow(ValidationError);
  });

  it("accepts a directory with a .git folder", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-git-"));
    fs.mkdirSync(path.join(tmp, ".git"));
    const service = new RepoService(db);
    expect(() => service.assertGitCheckout(tmp)).not.toThrow();
  });

  it("delete throws NotFoundError for an unknown repo", async () => {
    const service = new RepoService(db);
    await expect(service.delete("repo_missing")).rejects.toThrow(NotFoundError);
  });

  it("delete throws ConflictError when flows reference the repo", async () => {
    const ts = new Date().toISOString();
    await db.run(
      `INSERT INTO repos (id,name,cloud_url,default_branch,skip_install,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      "repo_in_use",
      "In use",
      "https://gitlab.example.com/group/in-use",
      "main",
      0,
      ts,
      ts,
    );
    await db.run(
      `INSERT INTO tasks (id,type,key,summary) VALUES ($1,$2,$3,$4)`,
      "task_r",
      "generic",
      "R-1",
      "t",
    );
    await db.run(
      `INSERT INTO flows (id,task_id,name,status,repo_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      "flw_r",
      "task_r",
      "flow",
      "active",
      "repo_in_use",
      ts,
      ts,
    );
    const service = new RepoService(db);
    await expect(service.delete("repo_in_use")).rejects.toThrow(ConflictError);
    expect(await db.repoById("repo_in_use")).toBeDefined();
  });
});
