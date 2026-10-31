import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AtRestCipher } from "./at-rest-cipher";

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
  afterEach(() => {
    vi.resetModules();
    delete process.env.DATABASE_PATH;
  });

  it("stores tokens sealed and lists metadata without SELECT token", async () => {
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "devflow-sealed-gl-")), "test.db");
    process.env.DATABASE_PATH = dbPath;
    const { db } = await import("./index");
    db.connection();

    const inst = db.gitlabInstances.add({
      name: "corp",
      base_url: "https://gitlab.example.com",
      token: "secret-token",
    });

    const row = db.get<{ token: string }>(`SELECT token FROM gitlab_instances WHERE id=?`, inst.id);
    expect(row?.token).toBeTruthy();
    expect(row?.token).not.toBe("secret-token");
    expect(db.integrationSecrets.isSealed(row?.token ?? "")).toBe(true);

    expect(db.gitlabInstances.listMeta()).toEqual([
      {
        id: inst.id,
        name: "corp",
        base_url: "https://gitlab.example.com",
        created_at: inst.created_at,
      },
    ]);
    expect(db.gitlabInstances.readToken(inst.id)).toBe("secret-token");
  });
});
