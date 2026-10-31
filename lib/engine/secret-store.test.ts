import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_KEYS } from "@/constants/settings";
import { SecretStore } from "./secret-store";

const mkDbPath = () =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), "devflow-secrets-")), "test.db");

describe("SecretStore", () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.DATABASE_PATH;
  });

  it("reads secrets from settings and redacts known values", async () => {
    const dbPath = mkDbPath();
    process.env.DATABASE_PATH = dbPath;
    const { db } = await import("../db");
    db.connection();
    db.setSetting(SETTINGS_KEYS.SECRETS, { API_TOKEN: "super-secret-token" });

    const store = new SecretStore(db);
    expect(store.all()).toEqual({ API_TOKEN: "super-secret-token" });
    expect(store.redact("failed: super-secret-token leaked")).toBe("failed: •••• leaked");
  });

  it("uses an explicit secrets map without reading settings", async () => {
    const dbPath = mkDbPath();
    process.env.DATABASE_PATH = dbPath;
    const { db } = await import("../db");
    db.connection();

    const store = new SecretStore(db);
    expect(store.redact("x secret-y z", { ONE: "secret-y" })).toBe("x •••• z");
  });
});
