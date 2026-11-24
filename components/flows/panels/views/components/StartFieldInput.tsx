"use client";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Field, FieldTitle } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import type { StartContractField } from "@/types/startContract";

/** The form row for one start contract field (the engine coerces/validates). */
export function StartFieldInput({
  field, value, onChange,
}: {
  field: StartContractField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const text = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <Field>
      <div className="flex items-center gap-2">
        <FieldTitle>{field.label || field.key}</FieldTitle>
        {field.label && <code className="font-mono text-[11px] text-muted-foreground">{field.key}</code>}
        <Badge variant="outline" className="text-[10px]">{field.type}</Badge>
        {field.required && <Badge className="bg-warning/10 text-warning text-[10px]">required</Badge>}
      </div>
      {field.type === "boolean" ? (
        <label className="flex items-center gap-2 text-[13px] cursor-pointer">
          <Checkbox
            className="shrink-0"
            checked={value === true}
            onCheckedChange={(v) => onChange(v === true)}
          />
          <span className="text-muted-foreground text-[12px]">{field.label || field.key}</span>
        </label>
      ) : field.type === "object" || field.type === "array" ? (
        <Textarea
          id={`start-${field.key}`}
          value={text}
          rows={3}
          className="font-mono text-[12px]"
          placeholder={field.type === "array" ? "[ … ]" : "{ … }"}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Input
          id={`start-${field.key}`}
          type={field.type === "number" ? "number" : "text"}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}
