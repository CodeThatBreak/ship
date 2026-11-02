import { describe, expect, it, vi } from "vitest";
import { db } from "../../db/app";
import { WorktreeManager } from "./worktreeLifecycle";

describe("WorktreeManager lifecycle events (CR-073)", () => {
  it("writes node_key (not the row id) into event data.nodeKey", () => {
    const get = vi.spyOn(db, "get").mockReturnValue({ node_key: "build" });
    const mgr = new WorktreeManager();
    const data = (
      mgr as unknown as {
        lifecycleData: (
          flowId: string,
          nodeId: string | null | undefined,
          extra?: Record<string, unknown>,
        ) => Record<string, unknown> | undefined;
      }
    ).lifecycleData("flow-1", "node-row-id", { branch: "main" });

    expect(get).toHaveBeenCalled();
    expect(data?.nodeKey).toBe("build");
    expect(data?.nodeKey).not.toBe("node-row-id");
    get.mockRestore();
  });
});
