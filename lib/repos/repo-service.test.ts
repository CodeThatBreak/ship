import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { RepoService } from "./repo-service";

const mkDbPath = () =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), "devflow-repo-svc-")), "test.db");

describe("RepoService", () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.DATABASE_PATH;
  });

  it("rejects paths that are not git checkouts", async () => {
    const dbPath = mkDbPath();
    process.env.DATABASE_PATH = dbPath;
    const { db } = await import("../db");
    db.connection();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-nogit-"));
    const service = new RepoService(db);
    expect(() => service.assertGitCheckout(tmp)).toThrow(ValidationError);
  });

  it("accepts a directory with a .git folder", async () => {
    const dbPath = mkDbPath();
    process.env.DATABASE_PATH = dbPath;
    const { db } = await import("../db");
    db.connection();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-git-"));
    fs.mkdirSync(path.join(tmp, ".git"));
    const service = new RepoService(db);
    expect(() => service.assertGitCheckout(tmp)).not.toThrow();
  });

  it("delete throws NotFoundError for an unknown repo", async () => {
    const dbPath = mkDbPath();
    process.env.DATABASE_PATH = dbPath;
    const { db } = await import("../db");
    db.connection();
    const service = new RepoService(db);
    expect(() => service.delete("repo_missing")).toThrow(NotFoundError);
  });

  it("delete throws ConflictError when flows reference the repo", async () => {
    const dbPath = mkDbPath();
    process.env.DATABASE_PATH = dbPath;
    const { db } = await import("../db");
    db.connection();
    const ts = new Date().toISOString();
    db.run(
      `INSERT INTO repos (id,name,cloud_url,default_branch,skip_install,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?)`,
      "repo_in_use",
      "In use",
      "https://gitlab.example.com/group/in-use",
      "main",
      0,
      ts,
      ts,
    );
    db.run(
      `INSERT INTO tasks (id,type,key,summary) VALUES (?,?,?,?)`,
      "task_r",
      "generic",
      "R-1",
      "t",
    );
    db.run(
      `INSERT INTO flows (id,task_id,name,status,repo_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`,
      "flw_r",
      "task_r",
      "flow",
      "active",
      "repo_in_use",
      ts,
      ts,
    );
    const service = new RepoService(db);
    expect(() => service.delete("repo_in_use")).toThrow(ConflictError);
    expect(db.repoById("repo_in_use")).toBeDefined();
  });
});
