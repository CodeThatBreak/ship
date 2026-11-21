"use client";

import type { ReactNode } from "react";
import { isFailedStatus, statusVariantOf } from "@/constants/flow";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

/**
 * One row of a branch fact (§2.4): the status badge, the branch's title/name,
 * and its `MR !iid ↗` link when the row carries one. Domain-neutral — callers
 * add row-local extras through the `detail` (under the name) and `trailing`
 * (after the link) slots, so feature panels keep their own actions.
 */
export const BranchFactRow = ({
  name,
  status,
  title,
  mrUrl,
  mrIid,
  detail,
  trailing,
}: {
  /** the branch's git name (rendered as code next to the title) */
  name: string;
  /** the branch fact's status value (the flow's row status vocabulary) */
  status: string;
  /** the branch's display title; falls back to the git name */
  title?: string | null;
  /** the change_request fact's MR url — the link renders only when set */
  mrUrl?: string | null;
  /** the change_request fact's MR iid, shown in the link text */
  mrIid?: number | null;
  /** extra lines under the name (e.g. a transient error) */
  detail?: ReactNode;
  /** trailing actions / inline indicators after the MR link */
  trailing?: ReactNode;
}) => {
  return (
    <Card className="px-4 py-3 flex items-center gap-3 flex-wrap">
      <Badge
        className={statusVariantOf(status)}
        variant={isFailedStatus(status) ? "destructive" : undefined}
      >
        {status.replace(/_/g, " ")}
      </Badge>
      <div className="flex-1 min-w-0">
        <span className="font-medium text-sm">{title ?? name}</span>
        <code className="text-xs text-muted-foreground ml-2">{name}</code>
        {detail}
      </div>
      {mrUrl && (
        <a href={mrUrl} target="_blank" rel="noopener noreferrer" className="text-info hover:underline text-xs">
          MR !{mrIid} ↗
        </a>
      )}
      {trailing}
    </Card>
  );
};