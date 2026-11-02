"use client";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { MODEL_FALLBACK_NOTE } from "../constants";

/**
 * The default-model select. The stored value arrives normalized (no bracket
 * params — the feature helper strips leftovers defensively). Props are
 * primitives + one stable callback so this stays re-render-safe (AGENTS.md §2.5).
 */
export const DefaultModelFields = ({ options, stored, source, saving, onSave }: {
  options: string[];
  stored: string | null;
  source: string | null;
  saving?: boolean;
  onSave: (value: string | null) => void;
}) => {
  return (
    <div>
      <Field>
        <FieldLabel htmlFor="settings-default-model">Default model</FieldLabel>
        <FieldDescription>
          Used for every agent run unless a different model is picked when running a node.
        </FieldDescription>
        <div className="flex gap-2 items-center flex-wrap mt-2">
          <Select value={stored} disabled={saving} onValueChange={(v) => onSave(v)}>
            <SelectTrigger id="settings-default-model" className="max-w-[280px]">
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
      </Field>
    </div>
  );
};
