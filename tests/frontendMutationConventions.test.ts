import { describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";

import {
  invalidateFlowDetail,
  invalidateFlowPrompts,
} from "@/hooks/invalidateFlowQueries";
import { layoutSyncFromPatchOk } from "@/components/templateEditor/hooks/useNodePositions";
import { queryKeys } from "@/constants/queryKeys";

describe("frontend mutation conventions (Task 15)", () => {
  it("layoutSyncFromPatchOk distinguishes success from HTTP failure (CR-237)", () => {
    expect(layoutSyncFromPatchOk(true)).toBe("saved");
    expect(layoutSyncFromPatchOk(false)).toBe("error");
  });

  it("invalidateFlowPrompts covers every prompt key family (CR-126)", async () => {
    const calls: unknown[][] = [];
    const queryClient = {
      invalidateQueries: vi.fn(async (opts: { queryKey: readonly unknown[] }) => {
        calls.push([...opts.queryKey]);
      }),
    } as unknown as QueryClient;

    await invalidateFlowPrompts(queryClient, "flow-1");

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(4);
    expect(calls).toContainEqual([...queryKeys.flows.promptScope("flow-1")]);
    expect(calls).toContainEqual([...queryKeys.flows.prompts("flow-1")]);
    expect(calls).toContainEqual(["flows", "node-prompt", "flow-1"]);
    expect(calls).toContainEqual(["flows", "node-branch-prompt", "flow-1"]);
  });

  it("invalidateFlowDetail targets the cockpit snapshot key (CR-027)", async () => {
    const queryClient = {
      invalidateQueries: vi.fn(async () => undefined),
    } as unknown as QueryClient;

    await invalidateFlowDetail(queryClient, "flow-9");

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.flows.detail("flow-9"),
    });
  });
});
