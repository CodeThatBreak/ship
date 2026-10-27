"use client";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { MODEL_FALLBACK_NOTE } from "../constants";

/**
 * The default-model select. The stored value arrives normalized (no bracket
 * params — the feature helper strips leftovers defensively). Props are
 * primitives + one stable callback so this stays re-render-safe (AGENTS.md §1.3).
 */
export function DefaultModelFields({ options, stored, source, saving, onSave }: {
  options: string[];
  stored: string | null;
  source: string | null;
  saving?: boolean;
  onSave: (value: string | null) => void;
}) {
  return (
    <div>
      <div className="text-[13px] font-medium mb-2">Default model</div>
      <div className="flex gap-2 items-center flex-wrap">
        <Select value={stored} disabled={saving} onValueChange={(v) => onSave(v)}>
          <SelectTrigger className="max-w-[280px]">
            <SelectValue placeholder="Account default" />
          </SelectTrigger>
          <SelectContent>
            {options.map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {source === "fallback" && (
          <span className="text-[12px] text-muted-foreground">{MODEL_FALLBACK_NOTE}</span>
        )}
      </div>
      <p className="text-muted-foreground text-[12px] mt-2">
        Used for every agent run unless a different model is picked when running a node.
      </p>
    </div>
  );
}
