"use client";
import { Info, Layers } from "lucide-react";
import { Markdown } from "@/components/shared/Markdown";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ArtifactPayload } from "../types/artifactPayload";

/**
 * The plan artifact body — the master plan section's rendered DOM, promoted out
 * of the PlanView feature so any declarative node can render a `plan` artifact
 * by kind. Loading/error states stay with the fetching section that owns them.
 */
export const PlanArtifactView = ({ artifact }: { artifact: ArtifactPayload }) => {
  const feedback =
    typeof artifact.meta?.feedback === "string" ? artifact.meta.feedback : null;

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <Layers size={14} /> Master plan
        {feedback ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button type="button" aria-label="Plan refinement feedback" className="inline-flex" />
              }
            >
              <Info size={12} className="text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>
              <div className="border-l-[3px] pl-2.5 text-xs text-muted-foreground">
                Refined from feedback: &quot;{feedback}&quot;
              </div>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </h3>

      <Card className="px-4 py-4">
        <Markdown className="text-[13px]">{artifact.content}</Markdown>
      </Card>
    </div>
  );
};
