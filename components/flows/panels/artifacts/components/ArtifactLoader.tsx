"use client";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessageOf } from "@/hooks/fetchJson";
import { useArtifact } from "../../../hooks/useArtifact";
import type { ArtifactPayload } from "../types/artifactPayload";
import { ArtifactLoaderSkeleton } from "./ArtifactLoaderSkeleton";

/** One fetched artifact rendered by the caller (loading / error / content §2.8). */
export const ArtifactLoader = ({
  id,
  render,
}: {
  id: string;
  render: (artifact: ArtifactPayload) => React.ReactNode;
}) => {
  const { data: art, isPending, isError, error, refetch } = useArtifact(id);

  if (isPending) return <ArtifactLoaderSkeleton />;

  if (isError) {
    return (
      <div role="alert" className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <span className="flex-1 min-w-0">
          {errorMessageOf(error) ?? "The artifact could not be loaded."}
        </span>
        <Button size="xs" variant="outline" onClick={() => void refetch()}>
          <RotateCcw size={12} /> Retry
        </Button>
      </div>
    );
  }

  if (!art) {
    return <p className="text-muted-foreground text-[13px]">The artifact is empty.</p>;
  }

  return <>{render(art)}</>;
};
