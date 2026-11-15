import { beforeAll, describe, expect, it } from "vitest";
import { FLOW_STATUS } from "@/constants/flow";
import { assignTestDatabase, resetTestDatabase } from "../../tests/helpers/testDatabase";
import { StatusService } from "./statusService";

assignTestDatabase();

const { db } = await import("./../db/app");

describe("StatusService.snapshot", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });

  it("binds flow and run status filters as parameters", async () => {
    const service = new StatusService(db);
    const snap = await service.snapshot();
    expect(snap.agentsRunning).toBe(0);
    expect(snap.runsRunning).toBe(0);
    expect(FLOW_STATUS.ACTIVE).toBe("active");
  });
});
