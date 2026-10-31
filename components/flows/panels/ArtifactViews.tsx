"use client";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { RotateCcw } from "lucide-react";
import type { Node } from "@/types/flow";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { EmptyHint } from "@/components/shared";
import { FLOW_STATUS } from "@/constants/flow";
import { errorMessageOf } from "@/hooks/fetch-json";
import { useArtifact } from "../hooks/useArtifact";
import type { ArtifactDetail } from "../queries";

/** The artifact payload panels read — `.content` and optional `.meta`. */
export type ArtifactPayload = ArtifactDetail;

/** Versioned artifact tabs + a single fetched artifact rendered by the caller. */
export const GenericArtifact = ({
  node,
  kind,
  empty,
  icon: Icon,
}: {
  node: Node;
  kind: string;
  empty: string;
  icon?: LucideIcon;
}) => {
  const arts = node.artifacts.filter((a) => a.kind === kind);
  const [sel, setSel] = useState<string | null>(null);
  const current = arts.find((a) => a.id === sel) ?? arts[arts.length - 1];
  return (
    <div>
      {arts.length > 1 && <VersionTabs arts={arts} sel={current?.id} onSel={setSel} className="mb-3.5" />}
      {current ? (
        <ArtifactLoader
          id={current.id}
          render={(loaded) => (
            <pre className="overflow-y-auto whitespace-pre-wrap bg-background border border-border rounded-lg p-3.5 text-[12.5px] font-mono">
              {loaded.content}
            </pre>
          )}
        />
      ) : (
        <EmptyHint icon={Icon}>{empty}</EmptyHint>
      )}
    </div>
  );
};

export const VersionTabs = ({
  arts,
  sel,
  onSel,
  className,
  captions,
}: {
  arts: { id: string; version: number; status: string }[];
  sel?: string;
  onSel: (id: string) => void;
  className?: string;
  /** caption copy per artifact id (§6b) — rendered under the v{n} label */
  captions?: Map<string, string>;
}) => {
  return (
    <div className={cn("flex gap-1.5 flex-wrap", className)}>
      {arts.map((a) => {
        const caption = captions?.get(a.id);
        return (
          <Button
            key={a.id}
            size="sm"
            variant={sel === a.id ? "default" : "outline"}
            className={cn(
              "whitespace-nowrap",
              caption && "h-auto flex-col items-center gap-0 px-2.5 py-1",
            )}
            onClick={() => onSel(a.id)}
          >
            <span>
              v{a.version}
              {a.status === FLOW_STATUS.APPROVED ? " ✓" : ""}
            </span>
            {caption && (
              <span
                className={cn(
                  "text-[10px] leading-tight max-w-40 truncate",
                  sel === a.id
                    ? "text-primary-foreground/70"
                    : "text-muted-foreground",
                )}
              >
                {caption}
              </span>
            )}
          </Button>
        );
      })}
    </div>
  );
};

const ArtifactLoaderSkeleton = () => (
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
