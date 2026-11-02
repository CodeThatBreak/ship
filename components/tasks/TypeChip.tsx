"use client";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LiveTask } from "@/types/tasks";
import { issueTypeStyle } from "./constants";

/** The key chip in the Task column: deep link to the provider, type-tinted. */
export const TypeChip = ({ task }: { task: LiveTask }) => {
  const { Icon, className } = issueTypeStyle(task.issueType);
  return (
    <a
      href={task.externalUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-[12px] font-medium transition-colors hover:brightness-125",
        className,
      )}
      title={task.issueType || "issue"}
    >
      <Icon size={12} />
      <span className="font-mono">{task.key}</span>
      <ExternalLink size={9} className="opacity-50" />
    </a>
  );
};
