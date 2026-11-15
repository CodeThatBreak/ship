import { beforeAll, describe, expect, it, vi } from "vitest";
import { settingsPatchBodySchema } from "../schemas/settingsPatch";
import { settingString, settingStringArray } from "../schemas/settingValues";
import { assignTestDatabase, resetTestDatabase } from "../../tests/helpers/testDatabase";
import { SettingsService } from "./settingsService";

assignTestDatabase();

const { db } = await import("../db/app");

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
  beforeAll(async () => {
    await resetTestDatabase();
  });

  it("does not write settings when the transaction fails mid-way", async () => {
    await db.setSetting("default_harness", "initial");

    const service = new SettingsService(db);
    let calls = 0;
    const orig = db.setSetting.bind(db);
    vi.spyOn(db, "setSetting").mockImplementation(async (key, value) => {
      calls += 1;
      if (calls === 2) throw new Error("simulated failure");
      await orig(key, value);
    });

    await expect(
      service.update({
        default_harness: "cursor",
        default_execution_mode: "local",
      }),
    ).rejects.toThrow("simulated failure");
    expect(await db.getSetting("default_harness", settingString, "")).toBe("initial");
    expect(await db.getSetting("default_execution_mode", settingString, "")).not.toBe("local");
  });

  it("applies a valid patch atomically", async () => {
    const service = new SettingsService(db);
    await service.update({
      default_execution_mode: "local",
      http_allowlist: ["Example.COM", ""],
    });

    expect(await db.getSetting("default_execution_mode", settingString, "")).toBe("local");
    expect(await db.getSetting("http_allowlist", settingStringArray, [])).toEqual(["example.com"]);
    expect(await service.httpAllowlist()).toEqual(["example.com"]);
  });
});
