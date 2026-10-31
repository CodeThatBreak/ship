import { describe, expect, it } from "vitest";
import { queryKeys } from "@/constants/query-keys";
import { artifactQueryOptions } from "@/components/flows/queries";
import { repoChoicesQueryOptions } from "@/components/builder/queries";
import { nodeContractQueryOptions } from "@/components/template-editor/queries";
import { settingsQueryOptions } from "@/components/settings/queries";

describe("frontend query ownership (Task 13)", () => {
  it("keeps editor repo choices off the full repos key (CR-005)", () => {
    expect(queryKeys.repoChoices).not.toEqual(queryKeys.repos);
    expect(repoChoicesQueryOptions().queryKey).toEqual(queryKeys.repoChoices);
  });

  it("uses one throwing queryFn per settings key (CR-135)", () => {
    expect(settingsQueryOptions().queryKey).toEqual(queryKeys.settings);
  });

  it("keys node contracts by request URL with shared options (CR-135)", () => {
    const url = "/api/contracts?def=nt_agent";
    expect(nodeContractQueryOptions(url).queryKey).toEqual(
      queryKeys.nodeContracts(url),
    );
  });

  it("caches artifacts as immutable with staleTime Infinity (CR-121)", () => {
    const opts = artifactQueryOptions("art_test");
    expect(opts.queryKey).toEqual(queryKeys.artifacts.detail("art_test"));
    expect(opts.staleTime).toBe(Infinity);
  });
});
