import { testGet } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../tests/helpers/testDatabase";
import { AtRestCipher } from "./atRestCipher";

assignTestDatabase();

const { db } = await import("./app");

describe("AtRestCipher", () => {
  it("seals and opens round-trip values", () => {
    const cipher = new AtRestCipher(Buffer.alloc(32, 7));
    const sealed = cipher.seal("super-secret-token");
    expect(sealed.startsWith("dfsec1:")).toBe(true);
    expect(cipher.open(sealed)).toBe("super-secret-token");
  });

  it("passes through legacy plaintext until migration", () => {
    const cipher = new AtRestCipher(Buffer.alloc(32, 3));
    expect(cipher.open("plain-old-token")).toBe("plain-old-token");
  });
});

describe("GitLabInstanceStore at rest", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });

  it("stores tokens sealed and lists metadata without SELECT token", async () => {
    const inst = await db.gitlabInstances.add({
      name: "corp",
      baseUrl: "https://gitlab.example.com",
      token: "secret-token",
    });

    const row = await testGet<{ token: string }>(`SELECT token FROM gitlab_instances WHERE id=$1`, inst.id);
    expect(row?.token).toBeTruthy();
    expect(row?.token).not.toBe("secret-token");
    expect(db.integrationSecrets.isSealed(row?.token ?? "")).toBe(true);

    expect(await db.gitlabInstances.listMeta()).toEqual([
      {
        id: inst.id,
        name: "corp",
        baseUrl: "https://gitlab.example.com",
        createdAt: inst.createdAt,
      },
    ]);
    expect(await db.gitlabInstances.readToken(inst.id)).toBe("secret-token");
  });
});
