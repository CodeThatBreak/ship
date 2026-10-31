import { describe, expect, it } from "vitest";
import { queryKeys } from "@/constants/queryKeys";
import { INSTANCE_SURFACE } from "../constants";
import { integrationStatusInvalidations } from "./integrationStatusInvalidation";
import { requireCreatedInstance } from "./requireCreatedInstance";

describe("requireCreatedInstance (CR-256)", () => {
  it("returns the instance when present", () => {
    const row = {
      id: "1",
      name: "GitLab",
      baseUrl: "https://gitlab.com",
      tokenMasked: "••••",
    };
    expect(requireCreatedInstance({ instance: row })).toEqual(row);
  });

  it("throws when the server omits instance", () => {
    expect(() => requireCreatedInstance({})).toThrow(
      "Server did not return the new instance",
    );
  });
});

describe("integrationStatusInvalidations (CR-151)", () => {
  it("invalidates settings and git hosts for HOST surface", () => {
    expect(integrationStatusInvalidations(INSTANCE_SURFACE.HOST)).toEqual([
      queryKeys.settings,
      queryKeys.gitHosts,
    ]);
  });

  it("invalidates settings and task providers for TASK surface", () => {
    expect(integrationStatusInvalidations(INSTANCE_SURFACE.TASK)).toEqual([
      queryKeys.settings,
      queryKeys.taskProviders,
    ]);
  });
});
