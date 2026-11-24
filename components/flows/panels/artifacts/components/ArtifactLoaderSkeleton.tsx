"use client";
import { Skeleton } from "@/components/ui/skeleton";

/** Layout-mirroring skeleton for a single fetched artifact (AGENTS §2.8). */
export const ArtifactLoaderSkeleton = () => (
  <div
    aria-busy="true"
    aria-label="Loading artifact"
    className="space-y-2 rounded-lg border border-border bg-background p-3.5"
  >
    <Skeleton className="h-3 w-full" />
    <Skeleton className="h-3 w-11/12" />
    <Skeleton className="h-3 w-4/5" />
  </div>
);
