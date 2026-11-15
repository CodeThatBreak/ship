import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../../tests/helpers/testDatabase";
import { CursorCredentials } from "./credentials";

assignTestDatabase();

const { db } = await import("../../db/app");

describe("CursorCredentials", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });

  it("stores, reads, and clears the API key", async () => {
    const creds = new CursorCredentials(db.integrationSecrets);
    expect(await creds.isStored()).toBe(false);
    await creds.setApiKey("  sk-test  ");
    expect(await creds.apiKey()).toBe("sk-test");
    expect(await creds.isStored()).toBe(true);
    await creds.setApiKey("");
    expect(await creds.apiKey()).toBe("");
    expect(await creds.isStored()).toBe(false);
  });

  it("clear removes the stored key", async () => {
    const creds = new CursorCredentials(db.integrationSecrets);
    await creds.setApiKey("keep-me");
    await creds.clear();
    expect(await creds.isStored()).toBe(false);
  });
});
