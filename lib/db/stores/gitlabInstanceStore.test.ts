import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("../app");

describe("GitLabInstanceStore", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });

  it("lists and inserts gitlab_instances rows", async () => {
    const inst = await db.gitlabInstances.add({
      name: "corp",
      baseUrl: "https://gitlab.example.com",
      token: "secret",
    });
    expect(inst.id).toMatch(/^gli_/);
    expect(await db.gitlabInstances.listMeta()).toEqual([
      {
        id: inst.id,
        name: inst.name,
        baseUrl: inst.baseUrl,
        createdAt: inst.createdAt,
      },
    ]);
    expect(await db.gitlabInstances.readToken(inst.id)).toBe("secret");
  });
});
