import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "../errors";
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
});
