"use client";
import { useEffect, useRef, useState } from "react";
import { RotateCcw, Play, X, Info, Lock, Bot } from "lucide-react";
import { Modal } from "./ui/modal";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { Badge } from "./ui/badge";
import { Checkbox } from "./ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { cn } from "../lib/utils";

interface PromptData {
  prompt: string;
  label: string;
  description: string;
  variables: string[];
  mode: string;
  source: string;
  /** internal instructions were stripped from `prompt` and are re-appended at run time */
  appendsInternal?: boolean;
  /** context blocks for the picker (sub-plan refine prompts, §4/§7.5) */
  contextBlocks?: ContextBlockInfo[];
}

export interface ContextBlockInfo {
  id: string;
  label: string;
  description: string;
  /** rendered preview — what the model would see for this block */
  text: string;
  chars: number;
  defaultOn: boolean;
  locked: boolean;
}

export interface PromptRunExtras {
  /** start a clean agent instead of following up on the node's existing one */
  fresh?: boolean;
  /** ids of the context blocks to assemble server-side into {{context}} */
  contextBlocks?: string[];
}

export default function PromptModal({
  flowId,
  nodeKey,
  open,
  onClose,
  onRun,
  feedback,
  instructions,
  branch,
  showContextPicker,
  defaultFresh,
  hasAgent,
}: {
  flowId: string;
  nodeKey: string;
  open: boolean;
  onClose: () => void;
  onRun: (prompt: string, promptIsBody: boolean, extras: PromptRunExtras) => void;
  feedback?: string;
  instructions?: string;
  /** seed a branch-scoped sub-plan refine prompt (?branch=) */
  branch?: string;
  /** show the context block picker (scoped refines — the picker controls everything a fresh agent sees) */
  showContextPicker?: boolean;
  /** initial state of the "New agent" checkbox (scoped refines default fresh) */
  defaultFresh?: boolean;
  /** hide the fresh toggle when no agent exists yet — the first run is always fresh */
  hasAgent?: boolean;
}) {
  const [data, setData] = useState<PromptData | null>(null);
  const [edited, setEdited] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedBlocks, setSelectedBlocks] = useState<Set<string>>(new Set());
  const [fresh, setFresh] = useState(defaultFresh ?? false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const params = new URLSearchParams({ node: nodeKey });
    if (feedback) params.set("feedback", feedback);
    if (instructions) params.set("instructions", instructions);
    if (branch) params.set("branch", branch);
    fetch(`/api/flows/${flowId}/prompt?${params}`)
      .then((r) => r.json())
      .then((d: PromptData) => {
        setData(d);
        setEdited(d.prompt ?? "");
        const defaults = new Set<string>();
        for (const b of d.contextBlocks ?? []) {
          if (b.defaultOn || b.locked) defaults.add(b.id);
        }
        setSelectedBlocks(defaults);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [open, flowId, nodeKey, feedback, instructions, branch]);

  const insertVariable = (v: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart ?? edited.length;
    const before = edited.slice(0, pos);
    const after = edited.slice(pos);
    const insert = `{{${v}}}`;
    setEdited(before + insert + after);
    // Restore cursor after the inserted text
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = pos + insert.length;
    });
  };

  const resetToTemplate = () => {
    if (data) setEdited(data.prompt);
  };

  const toggleBlock = (id: string, locked: boolean) => {
    if (locked) return; // pinned: the engine includes it regardless
    setSelectedBlocks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const charCount = edited.length;
  const blocks = data?.contextBlocks ?? [];
  // locked blocks are always included — count them in the total
  const totalContextChars = blocks
    .filter((b) => selectedBlocks.has(b.id) || b.locked)
    .reduce((sum, b) => sum + b.chars, 0);
  const selectedIds = blocks.filter((b) => selectedBlocks.has(b.id) || b.locked).map((b) => b.id);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={data ? `Edit prompt — ${data.label}` : "Edit prompt"}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            <X size={14} /> Cancel
          </Button>
          <Button
            onClick={() =>
              onRun(edited, Boolean(data?.appendsInternal), {
                fresh: hasAgent ? fresh : undefined,
                contextBlocks: showContextPicker ? selectedIds : undefined,
              })
            }
            disabled={!edited.trim()}
          >
            <Play size={14} /> Run with this prompt
          </Button>
        </>
      }
    >
      {loading ? (
        <p className="text-muted-foreground"><Spinner /> Loading prompt…</p>
      ) : data ? (
        <div className="grid gap-3">
          <p className="text-muted-foreground text-[12.5px] m-0">{data.description}</p>

          {data.variables.length > 0 && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-[11px] text-muted-foreground uppercase tracking-[0.5px] mr-1">Insert:</span>
              {data.variables.map((v) => (
                <Badge
                  key={v}
                  className="cursor-pointer hover:border-info hover:text-info transition-colors"
                  onClick={() => insertVariable(v)}
                >
                  {`{{${v}}}`}
                </Badge>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={edited}
            onChange={(e) => setEdited(e.target.value)}
            className={cn(
              "w-full bg-background border border-border rounded-[10px] px-3.5 py-3",
              "text-[12.5px] font-mono leading-relaxed resize-y min-h-[280px]",
              "focus:outline-none focus:border-info focus:ring-[3px] focus:ring-accent-soft",
              "placeholder:text-muted-foreground"
            )}
            rows={16}
          />

          {data.appendsInternal && (
            <p className="text-muted-foreground text-[12px] m-0 flex items-start gap-1.5">
              <Info size={13} className="shrink-0 mt-[1px]" />
              <span>
                Only the editable part is shown — the internal instructions
                (output format, branch/commit rules, and run-time data like logs,
                diff or comments) are appended automatically when the prompt runs.
              </span>
            </p>
          )}

          {/* context picker — what the model sees, per block char counts. For a
              fresh agent this controls EVERYTHING the model sees. */}
          {showContextPicker && blocks.length > 0 && (
            <div className="border border-border rounded-[10px] px-3 py-2.5">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] font-medium uppercase tracking-[0.5px] text-muted-foreground">Context blocks</span>
                <span className="text-[11px] text-muted-foreground" title="total size of the selected context, assembled server-side">
                  {totalContextChars.toLocaleString()} chars
                </span>
                <Tooltip>
                  <TooltipTrigger>
                    <Info size={12} className="text-muted-foreground hover:text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    What the model will receive. Context is always re-assembled on the server — this selection is a hint, never the spec. A fresh agent sees exactly these blocks, nothing else.
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="grid gap-1.5">
                {blocks.map((b) => (
                  <label
                    key={b.id}
                    className={cn(
                      "flex items-start gap-2 text-[12.5px] rounded-[8px] px-2 py-1.5 transition-colors",
                      b.locked ? "opacity-70 cursor-not-allowed" : "cursor-pointer hover:bg-background"
                    )}
                    title={b.text ? b.text : undefined}
                  >
                    <Checkbox
                      className="shrink-0 mt-[1px]"
                      checked={selectedBlocks.has(b.id) || b.locked}
                      disabled={b.locked}
                      onCheckedChange={() => toggleBlock(b.id, b.locked)}
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
          )}

          {hasAgent && (
            <label className="flex items-start gap-2 text-[12.5px] cursor-pointer select-none">
              <Checkbox className="shrink-0 mt-[1px]" checked={fresh} onCheckedChange={(v) => setFresh(v === true)} />
              <span className="flex flex-col">
                <span className="flex items-center gap-1.5 font-medium"><Bot size={12} /> New agent</span>
                <span className="text-[11.5px] text-muted-foreground">
                  start a clean agent instead of continuing the current one — lower hallucination risk from
                  accumulated context; it only re-reads this branch's files
                </span>
              </span>
            </label>
          )}

          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span>{charCount.toLocaleString()} chars</span>
            {data.source === "override" && <Badge className="bg-warning/10 text-warning">custom override</Badge>}
            <div className="flex-1" />
            <Button size="sm" onClick={resetToTemplate} disabled={edited === data.prompt}>
              <RotateCcw size={12} /> Reset to template
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground">Failed to load prompt.</p>
      )}
    </Modal>
  );
}
