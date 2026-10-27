import { Info, Lock } from "lucide-react";
import type { ContextBlockInfo } from "@/hooks/use-flow-prompt";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The context-block picker: what the model sees, per block char counts. For a
 * fresh agent this controls EVERYTHING the model sees. Locked blocks are
 * engine-pinned — the engine includes them regardless, so the checkbox is
 * disabled and the toggling only runs on unlocked blocks.
 */
export function ContextPicker({
  blocks,
  selectedBlocks,
  totalContextChars,
  onToggleBlock,
}: {
  blocks: ContextBlockInfo[];
  selectedBlocks: Set<string>;
  totalContextChars: number;
  onToggleBlock: (id: string) => void;
}) {
  return (
    <div className="border border-border rounded-lg px-3 py-2.5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.5px] text-muted-foreground">Context blocks</span>
        <span className="text-[11px] text-muted-foreground" title="Total size of the context the model will see">
          {totalContextChars.toLocaleString()} chars
        </span>
        <Tooltip>
          <TooltipTrigger>
            <Info size={12} className="text-muted-foreground hover:text-muted-foreground cursor-help" />
          </TooltipTrigger>
          <TooltipContent>
            What the model will receive. Context is finalized when the agent runs — this selection is a guide. A fresh agent sees exactly these blocks, nothing else.
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="grid gap-1.5">
        {blocks.map((b) => (
          <label
            key={b.id}
            className={cn(
              "flex items-start gap-2 text-[12.5px] rounded-lg px-2 py-1.5 transition-colors",
              b.locked ? "opacity-70 cursor-not-allowed" : "cursor-pointer hover:bg-background"
            )}
            title={b.text ? b.text : undefined}
          >
            <Checkbox
              className="shrink-0 mt-[1px]"
              checked={selectedBlocks.has(b.id) || b.locked}
              disabled={b.locked}
              onCheckedChange={() => onToggleBlock(b.id)}
            />
            <span className="flex-1">
              <span className="flex items-center gap-1.5">
                <span className="font-medium">{b.label}</span>
                {b.locked && (
                  <Tooltip>
                    <TooltipTrigger>
                      <span className="inline-flex items-center gap-1 text-[10.5px] text-warning"><Lock size={10} /> locked</span>
                    </TooltipTrigger>
                    <TooltipContent>
                      Locked: the branch scope, files and dependencies are the contract a scoped refine works inside — the engine always includes it.
                    </TooltipContent>
                  </Tooltip>
                )}
                <span className="text-[11px] text-muted-foreground">{b.chars.toLocaleString()} chars</span>
              </span>
              <span className="block text-[11.5px] text-muted-foreground">{b.description}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
