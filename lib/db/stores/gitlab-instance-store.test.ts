import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mkDbPath = () =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), "devflow-gitlab-store-")), "test.db");

describe("GitLabInstanceStore", () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.DATABASE_PATH;
  });

  it("lists and inserts gitlab_instances rows", async () => {
    process.env.DATABASE_PATH = mkDbPath();
    const { db } = await import("../index");
    db.connection();
    const inst = db.gitlabInstances.add({
      name: "corp",
      base_url: "https://gitlab.example.com",
      token: "secret",
    });
    expect(inst.id).toMatch(/^gli_/);
    expect(db.gitlabInstances.list()).toEqual([inst]);
  });
});
