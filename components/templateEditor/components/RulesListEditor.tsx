"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";

const newRowId = (): string => crypto.randomUUID();

/**
 * One rule per row — rows join with newlines into the rules knob
 * (`prompt_rules` / `fix_prompt_rules`), which the runtime assembles after
 * the body, before the locked blocks.
 */
export const RulesListEditor = ({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
}) => {
  const [rows, setRows] = useState<{ id: string; text: string }[]>(() =>
    typeof value === "string" && value.trim()
      ? value.split("\n").map((text) => ({ id: newRowId(), text }))
      : [],
  );

  const write = (next: { id: string; text: string }[]) => {
    setRows(next);
    const joined = next.map((r) => r.text.trim()).filter(Boolean).join("\n");
    onChange(joined || undefined);
  };

  return (
    <div className="grid gap-1.5">
      {rows.map((r, i) => (
        <div key={r.id} className="flex gap-1.5 items-center">
          <span className="text-[11px] text-muted-foreground w-4 text-right shrink-0">
            {i + 1}.
          </span>
          <Input
            value={r.text}
            placeholder="e.g. always run the repo's typecheck before pushing"
            className="font-mono text-[12px]"
            onChange={(e) =>
              write(rows.map((x) => (x.id === r.id ? { ...x, text: e.target.value } : x)))
            }
          />
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground shrink-0"
            title="Remove rule"
            onClick={() => write(rows.filter((x) => x.id !== r.id))}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => setRows([...rows, { id: newRowId(), text: "" }])}
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
};
