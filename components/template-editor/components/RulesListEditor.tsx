"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";

/**
 * One rule per row — rows join with newlines into the rules knob
 * (`prompt_rules` / `fix_prompt_rules`), which the runtime assembles after
 * the body, before the locked blocks.
 */
export function RulesListEditor({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [rows, setRows] = useState<string[]>(() =>
    typeof value === "string" && value.trim() ? value.split("\n") : [],
  );

  // empty rows stay editable in place; only non-empty rows write through
  const write = (next: string[]) => {
    setRows(next);
    const joined = next.map((r) => r.trim()).filter(Boolean).join("\n");
    onChange(joined || undefined);
  };

  return (
    <div className="grid gap-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex gap-1.5 items-center">
          <span className="text-[11px] text-muted-foreground w-4 text-right shrink-0">{i + 1}.</span>
          <Input
            value={r}
            placeholder="e.g. always run the repo's typecheck before pushing"
            className="font-mono text-[12px]"
            onChange={(e) => write(rows.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground shrink-0"
            title="Remove rule"
            onClick={() => write(rows.filter((_, j) => j !== i))}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => setRows([...rows, ""])}
      >
        <Plus size={12} /> Add rule
      </Button>
      {rows.length === 0 && (
        <p className="text-[11px] text-muted-foreground m-0">
          No rules yet — the prompt runs with the engine&apos;s defaults only.
        </p>
      )}
    </div>
  );
}
