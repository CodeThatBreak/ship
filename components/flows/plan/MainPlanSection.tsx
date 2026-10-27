"use client";
import { Layers } from "lucide-react";
import { ArtifactLoader } from "../panels/shared";
import { Markdown } from "@/components/shared";
import { Card } from "@/components/ui/card";

/** The fetched plan artifact as the artifact loader resolves it. */
export interface LoadedArtifact {
  content: string;
  meta?: { feedback?: string } | null;
}

/** Main plan (level 1): the heading plus the selected version's markdown. */
export function MainPlanSection({
  planId,
  fetchArtifact,
}: {
  planId: string;
  fetchArtifact: (id: string) => Promise<unknown>;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
        <Layers size={14} /> Main plan
      </h3>

      <ArtifactLoader
        id={planId}
        fetchArtifact={fetchArtifact}
        render={(a: LoadedArtifact) => (
          <div>
            {a.meta?.feedback && (
              <div className="text-xs text-muted-foreground border-l-[3px] border-violet-500 pl-2.5 mb-3">
                Refined from feedback: &quot;{a.meta.feedback}&quot;
              </div>
            )}
            <Card className="px-4 py-4">
              <Markdown className="text-[13px]">{a.content}</Markdown>
            </Card>
          </div>
        )}
      />
    </div>
  );
}
