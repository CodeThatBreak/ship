"use client";
import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import type { Node } from "@/types/flow";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { FLOW_STATUS } from "@/constants/flow";

/** The artifact payload as returned by /api/artifacts — panels read `.content`
 *  (and `.meta`); the fetcher's shape "varies by kind, so the reader narrows". */
export interface ArtifactPayload {
  content: string;
  meta?: Record<string, unknown>;
}

/** Versioned artifact tabs + a single fetched artifact rendered by the caller. */
export function GenericArtifact({
  node,
  kind,
  fetchArtifact,
  empty,
  icon: Icon,
}: {
  node: Node;
  kind: string;
  fetchArtifact: (id: string) => Promise<unknown>;
  empty: string;
  icon?: LucideIcon;
}) {
  const arts = node.artifacts.filter((a) => a.kind === kind);
  const [sel, setSel] = useState<string | null>(null);
  const current = arts.find((a) => a.id === sel) ?? arts[arts.length - 1];
  return (
    <div>
      {arts.length > 1 && <VersionTabs arts={arts} sel={current?.id} onSel={setSel} className="mb-3.5" />}
      {current ? (
        <ArtifactLoader id={current.id} fetchArtifact={fetchArtifact}
          render={(loaded) => <pre className="overflow-y-auto whitespace-pre-wrap bg-background border border-border rounded-lg p-3.5 text-[12.5px] font-mono">{loaded.content}</pre>} />
      ) : (
        <div className="text-center px-5 py-16">
          {Icon && <Icon size={32} className="text-muted-foreground mb-3 mx-auto" />}
          <p className="text-muted-foreground max-w-[380px] mx-auto">{empty}</p>
        </div>
      )}
    </div>
  );
}

export function VersionTabs({
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
}) {
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
}

/** One fetched artifact rendered by the caller (loading state §2.8). */
export function ArtifactLoader({
  id,
  fetchArtifact,
  render,
}: {
  id: string;
  /** the artifact fetcher passed to every panel (returns the raw payload) */
  fetchArtifact: (id: string) => Promise<unknown>;
  render: (artifact: ArtifactPayload) => React.ReactNode;
}) {
  const [art, setArt] = useState<ArtifactPayload | null>(null);
  useEffect(() => {
    let live = true;
    fetchArtifact(id).then((value) => {
      // the fetcher is intentionally lenient (it returns whatever the API
      // served) — the reader narrows, and ArtifactPayload is what render reads
      if (live) setArt(value as ArtifactPayload);
    });
    return () => { live = false; };
  }, [id, fetchArtifact]);
  if (!art) return <p className="text-muted-foreground"><Spinner /> Loading…</p>;
  return <>{render(art)}</>;
}
