"use client";
import { useEffect, useRef, useState } from "react";
import { RotateCcw, Play, X, Info } from "lucide-react";
import { Modal } from "./ui/modal";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { Badge } from "./ui/badge";
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
}

export default function PromptModal({
  flowId,
  nodeKey,
  open,
  onClose,
  onRun,
  feedback,
  instructions,
}: {
  flowId: string;
  nodeKey: string;
  open: boolean;
  onClose: () => void;
  onRun: (prompt: string, promptIsBody: boolean) => void;
  feedback?: string;
  instructions?: string;
}) {
  const [data, setData] = useState<PromptData | null>(null);
  const [edited, setEdited] = useState("");
  const [loading, setLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const params = new URLSearchParams({ node: nodeKey });
    if (feedback) params.set("feedback", feedback);
    if (instructions) params.set("instructions", instructions);
    fetch(`/api/flows/${flowId}/prompt?${params}`)
      .then((r) => r.json())
      .then((d: PromptData) => {
        setData(d);
        setEdited(d.prompt);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [open, flowId, nodeKey, feedback, instructions]);

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

  const charCount = edited.length;

  return (
    <Modal open={open} onClose={onClose} title={data ? `Edit prompt — ${data.label}` : "Edit prompt"}>
      {loading ? (
        <p className="text-muted"><Spinner /> Loading prompt…</p>
      ) : data ? (
        <div className="grid gap-3">
          <p className="text-muted text-[12.5px] m-0">{data.description}</p>

          {data.variables.length > 0 && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-[11px] text-muted uppercase tracking-[0.5px] mr-1">Insert:</span>
              {data.variables.map((v) => (
                <Badge
                  key={v}
                  className="cursor-pointer hover:border-accent hover:text-accent transition-colors"
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
              "w-full bg-bg-soft border border-border rounded-[10px] px-3.5 py-3",
              "text-[12.5px] font-mono leading-relaxed resize-y min-h-[280px]",
              "focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-soft",
              "placeholder:text-muted"
            )}
            rows={16}
          />

          {data.appendsInternal && (
            <p className="text-muted text-[12px] m-0 flex items-start gap-1.5">
              <Info size={13} className="shrink-0 mt-[1px]" />
              <span>
                Only the editable part is shown — the internal instructions
                (output format, branch/commit rules, and run-time data like logs,
                diff or comments) are appended automatically when the prompt runs.
              </span>
            </p>
          )}

          <div className="flex items-center gap-2 text-[12px] text-muted">
            <span>{charCount.toLocaleString()} chars</span>
            {data.source === "override" && <Badge variant="amber">custom override</Badge>}
            <div className="flex-1" />
            <Button size="sm" onClick={resetToTemplate} disabled={edited === data.prompt}>
              <RotateCcw size={12} /> Reset to template
            </Button>
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              variant="primary"
              onClick={() => onRun(edited, Boolean(data.appendsInternal))}
              disabled={!edited.trim()}
            >
              <Play size={14} /> Run with this prompt
            </Button>
            <Button onClick={onClose}>
              <X size={14} /> Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-muted">Failed to load prompt.</p>
      )}
    </Modal>
  );
}
