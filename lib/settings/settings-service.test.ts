import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { settingsPatchBodySchema } from "../schemas/settings-patch";
import { settingString, settingStringArray } from "../schemas/setting-values";
import { SettingsService } from "./settings-service";

const mkDbPath = () =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), "devflow-settings-")), "test.db");

describe("settingsPatchBodySchema", () => {
  it("rejects invalid default_execution_mode in a multi-field patch (CR-048)", () => {
    const schema = settingsPatchBodySchema(["cursor"]);
    const result = schema.safeParse({
      cursor_api_key: "secret-key",
      default_harness: "cursor",
      default_execution_mode: "bogus",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-string http_allowlist entries", () => {
    const schema = settingsPatchBodySchema(["cursor"]);
    const result = schema.safeParse({ http_allowlist: [{}] });
    expect(result.success).toBe(false);
  });
});

describe("SettingsService.update", () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.DATABASE_PATH;
  });

  it("does not write settings when the transaction fails mid-way", async () => {
    const dbPath = mkDbPath();
    process.env.DATABASE_PATH = dbPath;
    const { db } = await import("../db");
    db.connection();
    db.setSetting("default_harness", "initial");

    const service = new SettingsService(db);
    let calls = 0;
    const orig = db.setSetting.bind(db);
    vi.spyOn(db, "setSetting").mockImplementation((key, value) => {
      calls += 1;
      if (calls === 2) throw new Error("simulated failure");
      orig(key, value);
    });

    expect(() =>
      service.update({
        default_harness: "cursor",
        default_execution_mode: "local",
      }),
    ).toThrow("simulated failure");
    expect(db.getSetting("default_harness", settingString, "")).toBe("initial");
    expect(db.getSetting("default_execution_mode", settingString, "")).not.toBe("local");
  });

  it("applies a valid patch atomically", async () => {
    const dbPath = mkDbPath();
    process.env.DATABASE_PATH = dbPath;
    const { db } = await import("../db");
    db.connection();

    const service = new SettingsService(db);
    service.update({
      default_execution_mode: "local",
      http_allowlist: ["Example.COM", ""],
    });

    expect(db.getSetting("default_execution_mode", settingString, "")).toBe("local");
    expect(db.getSetting("http_allowlist", settingStringArray, [])).toEqual(["example.com"]);
    expect(service.httpAllowlist()).toEqual(["example.com"]);
  });
});
