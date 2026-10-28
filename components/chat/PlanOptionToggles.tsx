"use client";

import { LayersIcon } from "lucide-react";

import { InputGroupButton } from "@/components/ui/input-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PlanOptions } from "./types";

/** The decompose toggle shown in the chat composer's action row for
 *  plan-style nodes, before the node's first run exists. */
export default function PlanOptionToggles({
  planOptions,
  onChange,
}: {
  planOptions: PlanOptions;
  onChange?: (opts: PlanOptions) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <InputGroupButton
            size="icon-xs"
            variant="outline"
            aria-pressed={planOptions.decompose}
            aria-label="Decompose"
            title={
              planOptions.decompose
                ? "Decompose — on: exploration runs in parallel, then merges; click to turn off"
                : "Decompose — explore different areas of the repo in parallel; click to turn on"
            }
            onClick={() => onChange?.({ decompose: !planOptions.decompose })}
            className={cn(
              planOptions.decompose &&
                "border-info/40 bg-info/10 text-info",
            )}
          />
        }
      >
        <LayersIcon className="size-3" />
      </TooltipTrigger>
      <TooltipContent>
        Decompose: use sub-agents to explore different areas of the
        repo in parallel, then merge the results into a single
        cohesive plan
      </TooltipContent>
    </Tooltip>
  );
}
