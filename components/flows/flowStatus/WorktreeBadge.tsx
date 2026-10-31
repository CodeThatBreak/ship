import { FolderGit2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { WorktreeStatus } from "@/types/flows";

/** Worktree state for one local flow row: branch, dirty dot, ahead/behind. */
export const WorktreeBadge = ({ status }: { status: WorktreeStatus }) => {
  if (!status.registered) {
    return (
      <Badge
        variant="outline"
        className="border-warning/30 text-warning"
        title={`Code workspace not ready yet${status.reason ? `: ${status.reason}` : ""}`}
      >
        <FolderGit2 size={11} /> unavailable
      </Badge>
    );
  }
  const ahead = status.ahead ?? 0;
  const behind = status.behind ?? 0;
  const title =
    `${status.branch ?? "(detached)"}` +
    (status.dirty ? " · uncommitted changes" : " · clean") +
    (ahead ? ` · ${ahead} commit${ahead === 1 ? "" : "s"} ahead` : "") +
    (behind ? ` · ${behind} behind` : "") +
    (status.pushed ? " · pushed" : " · not pushed");
  return (
    <Badge
      variant="outline"
      title={title}
      className="max-w-[240px] gap-1 font-mono text-[11px]"
    >
      <FolderGit2 size={11} />
      <span className="truncate">{status.branch ?? "detached"}</span>
      {status.dirty && <span className="size-1.5 shrink-0 rounded-full bg-warning" />}
      {ahead > 0 && <span className="text-success">↑{ahead}</span>}
      {behind > 0 && <span className="text-warning">↓{behind}</span>}
    </Badge>
  );
};
