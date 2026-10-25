"use client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle2, PlugZap, Trash2, XCircle } from "lucide-react";
import type { InstanceRow, TestResult } from "../types";

export function InstanceCard({
  icon, instance, onTest, onDelete, testing, testResult,
}: {
  icon: React.ReactNode;
  instance: InstanceRow;
  onTest?: () => void;
  onDelete: () => void;
  testing?: boolean;
  testResult?: TestResult;
}) {
  return (
    <Card className="flex-row items-center gap-3 px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-[13.5px] truncate leading-tight">{instance.name || instance.baseUrl}</span>
          {testResult && (testResult.ok ? (
            <Badge className="bg-success/10 text-success shrink-0"><CheckCircle2 size={11} /> connected</Badge>
          ) : (
            <Badge variant="destructive" className="shrink-0"><XCircle size={11} /> failed</Badge>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-1 min-w-0">
          <span className="text-muted-foreground text-[12px] font-mono truncate">{instance.baseUrl}</span>
          {instance.email && (
            <span className="text-muted-foreground text-[12px] truncate">{instance.email}</span>
          )}
          <Badge variant="outline" className="font-mono text-[10.5px] shrink-0">{instance.tokenMasked}</Badge>
        </div>
      </div>
      {testResult && !testResult.ok && (
        <span className="text-destructive text-[11.5px] max-w-[220px] truncate" title={testResult.detail}>
          {testResult.detail}
        </span>
      )}
      <div className="flex items-center gap-0.5 shrink-0">
        {onTest && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Test connection"
                  onClick={onTest}
                  disabled={testing}
                />
              }
            >
              {testing ? <Spinner /> : <PlugZap size={14} className="text-muted-foreground" />}
            </TooltipTrigger>
            <TooltipContent>Test connection</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Remove instance"
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={onDelete}
              />
            }
          >
            <Trash2 size={14} />
          </TooltipTrigger>
          <TooltipContent>Remove instance</TooltipContent>
        </Tooltip>
      </div>
    </Card>
  );
}

/** Skeleton mirroring <InstanceCard /> — icon square + two text lines — so the
 *  pending instance list resolves without layout shift (AGENTS.md §1.8). */
export function InstanceCardSkeleton() {
  return (
    <Card aria-hidden className="flex-row items-center gap-3 px-4 py-3">
      <Skeleton className="size-9 shrink-0 rounded-lg" />
      <div className="flex-1 min-w-0 grid gap-1.5">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-3 w-56" />
      </div>
    </Card>
  );
}
