import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FLOW_STATUS } from "@/constants/flow";
import { StatusService } from "./status-service";

const mkDbPath = () =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), "devflow-status-")), "test.db");

describe("StatusService.snapshot", () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.DATABASE_PATH;
  });

  it("binds flow and run status filters as parameters", async () => {
    const dbPath = mkDbPath();
    process.env.DATABASE_PATH = dbPath;
    const { db } = await import("../db");
    db.connection();

    const service = new StatusService(db);
    const snap = service.snapshot();
    expect(snap.agentsRunning).toBe(0);
    expect(snap.runsRunning).toBe(0);
    expect(FLOW_STATUS.ACTIVE).toBe("active");
  });
});
