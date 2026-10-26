"use client";
/**
 * The multi-select config knob (the MCP sources field), extracted from
 * ConfigFieldRow.tsx: a checkbox group over the field's options, writing the
 * picked values as a string array — clearing every box drops the override so
 * the catalog/class default applies.
 */
import { Checkbox } from "../../ui/checkbox";
import { Field } from "../../ui/field";
import { FieldHeading } from "./FieldHeading";

export function MultiCheckboxField({
  field,
  selected,
  onChange,
}: {
  field: { key: string; label: string; help?: string; options?: { value: string; label: string; description?: string }[] };
  selected: string[];
  onChange: (v: unknown) => void;
}) {
  return (
    <Field>
      <FieldHeading field={field} />
      <div className="grid gap-1.5 rounded-lg border border-border p-2">
        {(field.options ?? []).map((o) => {
          const checked = selected.includes(o.value);
          return (
            <label
              key={o.value}
              className="flex items-start gap-2 text-[12.5px] cursor-pointer"
            >
              <Checkbox
                checked={checked}
                onCheckedChange={(v) => {
                  const next =
                    v === true
                      ? [...selected, o.value]
                      : selected.filter((s) => s !== o.value);
                  onChange(next.length ? next : undefined);
                }}
              />
              <span className="leading-tight">
                {o.label}
                {o.description && (
                  <span className="block text-[11px] text-muted-foreground">
                    {o.description}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      {selected.length === 0 && (
        <p className="text-[11px] text-muted-foreground m-0">
          Nothing selected — the runtime default applies (inline servers
          only).
        </p>
      )}
    </Field>
  );
}
