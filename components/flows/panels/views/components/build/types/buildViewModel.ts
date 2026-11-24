import type { Artifact, BranchRow } from "@/types/flow";

/** Derived facts shared by the build footer and code-diff tab. */
export interface BuildViewModel {
  latest: Artifact | undefined;
  canApprove: boolean;
  branches: BranchRow[];
  hasBranches: boolean;
  creatingMr: boolean;
  creatingMrBranches: Set<string>;
  mrErrorFor: (branch?: string) => string | null;
  approveAll: () => void;
  approveBranch: (name: string) => void;
  singleErr: string | null;
  allAwaiting: boolean;
}
