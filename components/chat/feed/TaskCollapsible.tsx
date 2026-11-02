"use client";

import * as React from "react";
import { CircleCheckIcon, LoaderCircleIcon } from "lucide-react";

import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";

/** Shared Task-style collapsible used by checklist edits and long status rows. */
export default function TaskCollapsible({
  title,
  status,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  status?: "running" | "error";
  icon?: React.ReactNode | null;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState<boolean | undefined>(
    defaultOpen || undefined,
  );
  return (
    <TraceCollapsible open={open ?? false} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>
        <TraceLine status={status}>
          <TraceIcon>
            {icon ??
              (status === "running" ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <CircleCheckIcon />
              ))}
          </TraceIcon>
          <TraceTitle>{title}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent
        keepMounted
        className="[&_[data-slot=trace-collapsible-content-inner]]:border-l-0 [&_[data-slot=trace-collapsible-content-inner]]:pl-0"
      >
        {children}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
