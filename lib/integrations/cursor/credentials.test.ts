import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CursorCredentials } from "./credentials";

const mkDbPath = () =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), "devflow-cursor-cred-")), "test.db");

describe("CursorCredentials", () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.DATABASE_PATH;
  });

  it("stores, reads, and clears the API key", async () => {
    const dbPath = mkDbPath();
    process.env.DATABASE_PATH = dbPath;
    const { db } = await import("../../db");
    db.connection();

    const creds = new CursorCredentials(db.integrationSecrets);
    expect(creds.isStored()).toBe(false);
    creds.setApiKey("  sk-test  ");
    expect(creds.apiKey()).toBe("sk-test");
    expect(creds.isStored()).toBe(true);
    creds.setApiKey("");
    expect(creds.apiKey()).toBe("");
    expect(creds.isStored()).toBe(false);
  });

  it("clear removes the stored key", async () => {
    const dbPath = mkDbPath();
    process.env.DATABASE_PATH = dbPath;
    const { db } = await import("../../db");
    db.connection();

    const creds = new CursorCredentials(db.integrationSecrets);
    creds.setApiKey("keep-me");
    creds.clear();
    expect(creds.isStored()).toBe(false);
  });
});
