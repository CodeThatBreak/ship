import { beforeAll, describe, expect, it, vi } from "vitest";
import { settingsPatchBodySchema } from "../schemas/settingsPatch";
import { settingString, settingStringArray } from "../schemas/settingValues";
import { assignTestDatabase, resetTestDatabase } from "../../tests/helpers/testDatabase";
import { SettingsService } from "./settingsService";

assignTestDatabase();

const { db } = await import("../db/app");

describe("settingsPatchBodySchema", () => {
  it("rejects invalid defaultExecutionMode in a multi-field patch (CR-048)", () => {
    const schema = settingsPatchBodySchema(["cursor"]);
    const result = schema.safeParse({
      cursorApiKey: "secret-key",
      defaultHarness: "cursor",
      defaultExecutionMode: "bogus",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-string httpAllowlist entries", () => {
    const schema = settingsPatchBodySchema(["cursor"]);
    const result = schema.safeParse({ httpAllowlist: [{}] });
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
    // tx-threaded signature: writes that join the transaction pass the tx client
    vi.spyOn(db, "setSetting").mockImplementation(async (key, value, tx) => {
      calls += 1;
      if (calls === 2) throw new Error("simulated failure");
      await orig(key, value, tx);
    });

    await expect(
      service.update({
        defaultHarness: "cursor",
        defaultExecutionMode: "local",
      }),
    ).rejects.toThrow("simulated failure");
    expect(await db.getSetting("default_harness", settingString, "")).toBe("initial");
    expect(await db.getSetting("default_execution_mode", settingString, "")).not.toBe("local");
  });

  it("applies a valid patch atomically", async () => {
    const service = new SettingsService(db);
    await service.update({
      defaultExecutionMode: "local",
      httpAllowlist: ["Example.COM", ""],
    });

    expect(await db.getSetting("default_execution_mode", settingString, "")).toBe("local");
    expect(await db.getSetting("http_allowlist", settingStringArray, [])).toEqual(["example.com"]);
    expect(await service.httpAllowlist()).toEqual(["example.com"]);
  });
});
