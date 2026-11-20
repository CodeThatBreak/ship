import { beforeAll, describe, expect, it } from "vitest";
import { SETTINGS_KEYS } from "@/constants/settings";
import { assignTestDatabase, resetTestDatabase } from "../../tests/helpers/testDatabase";
import { SecretStore } from "./secretStore/secretStore";

assignTestDatabase();

const { db } = await import("../db/app");

describe("SecretStore", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });

  it("reads secrets from settings and redacts known values", async () => {
    await db.setSetting(SETTINGS_KEYS.SECRETS, { API_TOKEN: "super-secret-token" });

    const store = new SecretStore(db, db.integrationSecrets);
    expect(await store.all()).toEqual({ API_TOKEN: "super-secret-token" });
    expect(await store.redact("failed: super-secret-token leaked")).toBe("failed: •••• leaked");
  });

  it("uses an explicit secrets map without reading settings", async () => {
    const store = new SecretStore(db, db.integrationSecrets);
    expect(await store.redact("x secret-y z", { ONE: "secret-y" })).toBe("x •••• z");
  });
});
