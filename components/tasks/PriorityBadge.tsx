"use client";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { priorityBadgeClass } from "./constants";

export const PriorityBadge = ({ priority }: { priority: string }) => (
  <Badge variant="outline" className={cn("text-[11px] border-transparent", priorityBadgeClass(priority))}>
    {priority || "—"}
  </Badge>
);
