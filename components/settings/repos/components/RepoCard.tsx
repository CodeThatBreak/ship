"use client";
import { useCallback } from "react";
import { CheckCircle2, FolderGit2, GitBranch, Pencil, Trash2, XCircle } from "lucide-react";
import type { Repo } from "@/components/settings/context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { REPO_BADGE } from "../constants";
import { tildePath } from "../paths";

/** One registered repo: icon square, name + branch/local badges, then the
 *  cloud URL and local checkout on the meta line (mirrors InstanceCard). */
export function RepoCard({
  repo, serverHome, onEdit, onDelete, deleting = false,
}: {
  repo: Repo;
  serverHome: string;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  deleting?: boolean;
}) {
  const edit = useCallback(() => onEdit(repo.id), [onEdit, repo.id]);
  const del = useCallback(() => onDelete(repo.id), [onDelete, repo.id]);

  return (
    <Card className="flex-row items-center gap-3 px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <FolderGit2 size={16} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-[13.5px] truncate leading-tight">{repo.name}</span>
          <Badge variant="outline" className="font-mono text-[10.5px] shrink-0">
            <GitBranch size={10} /> {repo.default_branch}
          </Badge>
          {repo.local_path && (repo.local_path_exists ? (
            <Badge className="bg-success/10 text-success shrink-0">
              <CheckCircle2 size={11} /> {REPO_BADGE.LOCAL_READY}
            </Badge>
          ) : (
            <Badge variant="destructive" className="shrink-0">
              <XCircle size={11} /> {REPO_BADGE.LOCAL_MISSING}
            </Badge>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-1 min-w-0">
          <span className="text-muted-foreground text-[12px] font-mono truncate">
            {repo.cloud_url}
          </span>
          {repo.local_path && (
            <span className="text-muted-foreground text-[12px] font-mono truncate">
              {tildePath(repo.local_path, serverHome)}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Edit repo"
                onClick={edit}
              />
            }
          >
            <Pencil size={14} className="text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent>Edit repo</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Remove repo"
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={del}
                disabled={deleting}
              />
            }
          >
            <Trash2 size={14} />
          </TooltipTrigger>
          <TooltipContent>Remove repo</TooltipContent>
        </Tooltip>
      </div>
    </Card>
  );
}

/** Skeleton mirroring <RepoCard /> — icon square + two text lines — so the
 *  pending repo list resolves without layout shift (AGENTS.md §1.8). */
export function RepoCardSkeleton() {
  return (
    <Card aria-hidden className="flex-row items-center gap-3 px-4 py-3">
      <Skeleton className="size-9 shrink-0 rounded-lg" />
      <div className="flex-1 min-w-0 grid gap-1.5">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-3 w-64" />
      </div>
    </Card>
  );
}
