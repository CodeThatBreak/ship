"use client";

import { GitMerge } from "lucide-react";
import type { BranchRow } from "@/types/flow";
import { BranchFactRow } from "@/components/shared/BranchFactRow";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/** One branch's MR-creation state and approval action in the build diff tab. */
export function BuildBranchRow({
  branch,
  error,
  creatingMr,
  awaitingApproval,
  onApprove,
}: {
  branch: BranchRow;
  error: string | null;
  creatingMr: boolean;
  awaitingApproval: boolean;
  onApprove: (name: string) => void;
}) {
  return (
    <BranchFactRow
      name={branch.name}
      title={branch.title}
      status={branch.status}
      mrUrl={branch.mrUrl}
      mrIid={branch.mrIid}
      detail={error ? <div className="text-destructive text-xs mt-1">{error}</div> : null}
      trailing={
        <>
          {creatingMr && (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
              <Spinner /> Creating MR…
            </span>
          )}
          {awaitingApproval && (
            <Button size="sm" onClick={() => onApprove(branch.name)}>
              <GitMerge size={13} /> {error ? "Retry: accept & create MR" : "Accept & create MR"}
            </Button>
          )}
        </>
      }
    />
  );
}
