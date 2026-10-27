"use client";

import {
  ChevronDownIcon,
  CompassIcon,
  FileTextIcon,
  PencilIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Prompt preview box over the chat (before the node's first run).
 *  Collapsed: a partial preview of the node's prompt with a fade-out. Clicking
 *  the preview expands it. The edit icon moves the prompt into the prompt
 *  modal (editor); Generate kicks off the run with the current options. */
export default function NodePromptBox({
  prompt,
  error = false,
  onRetry,
  open,
  onToggle,
  onEdit,
  onGenerate,
  generating = false,
  generateLabel = "Generate",
}: {
  prompt: string | null; // null = still loading
  /** the preview request failed (§2.8) — retryable inline */
  error?: boolean;
  onRetry?: () => void;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onGenerate: () => void;
  generating?: boolean;
  generateLabel?: string;
}) {
  const loaded = prompt != null && !error;

  return (
    <div className="shrink-0 mb-2.5 rounded-lg border border-border bg-background overflow-hidden">
      {/* header row: title + edit action */}
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[11px] font-medium uppercase tracking-[0.5px] text-muted-foreground">
          Prompt
        </span>
        {prompt && (
          <span className="text-[10.5px] text-muted-foreground">
            {prompt.length.toLocaleString()} chars
          </span>
        )}
        <span className="flex-1" />
        <ChevronDownIcon
          size={14}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform duration-150",
            !open && "-rotate-90",
          )}
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                className="!size-6"
                aria-label="Edit prompt"
                title="Move the prompt to the prompt editor"
                onClick={onEdit}
              />
            }
          >
            <PencilIcon />
          </TooltipTrigger>
          <TooltipContent>
            <p>Move the prompt to the prompt editor</p>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* preview body — click toggles expanded/collapsed; the bottom fade
          (in the collapsed state) communicates that more prompt follows */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        className="relative cursor-pointer select-none transition-colors hover:bg-foreground/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        {loaded ? (
          open ? (
            <ScrollArea className="max-h-56" viewportClassName="scroll-py-2">
              <pre className="m-0 whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {prompt}
              </pre>
            </ScrollArea>
          ) : (
            <pre className="m-0 whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground max-h-16 overflow-hidden">
              {prompt}
            </pre>
          )
        ) : error ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-2 px-3 py-2.5 text-[11px] text-destructive"
          >
            <span>Failed to load the prompt.</span>
            {onRetry && (
              <Button size="xs" variant="outline" onClick={onRetry}>
                Retry
              </Button>
            )}
          </div>
        ) : (
          <div className="px-3 py-3 text-[11px] text-muted-foreground" role="status">
            <Spinner /> Loading prompt…
          </div>
        )}
        {!open && loaded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-9 bg-gradient-to-t from-background via-background/85 to-transparent" />
        )}
        {!open && loaded && (
          <span className="pointer-events-none absolute bottom-1 left-3 text-[10px] font-mono text-muted-foreground/90">
            ··· +{Math.max(prompt.length - 240, 0).toLocaleString()} chars
          </span>
        )}
      </div>

      {/* footer row: generate action */}
      <div className="flex items-center justify-end gap-2 px-2.5 py-1.5">
        <Button
          size="xs"
          variant="default"
          disabled={generating}
          onClick={onGenerate}
        >
          <CompassIcon /> {generateLabel}
        </Button>
      </div>
    </div>
  );
}
