"use client";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import type { Node } from "@/types/flow";
import { EmptyHint } from "@/components/shared/EmptyHint";
import { ArtifactLoader } from "./ArtifactLoader";
import { VersionTabs } from "./VersionTabs";

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
      {arts.length > 1 && (
        <VersionTabs arts={arts} sel={current?.id} onSel={setSel} className="mb-3.5" />
      )}
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
