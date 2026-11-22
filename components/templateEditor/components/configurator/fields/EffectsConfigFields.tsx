"use client";
/**
 * The declarative `effects` block: one checkbox group per lifecycle. It is a
 * nested object (the split block's precedent), so a plain ConfigField row
 * can't express it — `DeclarativeConfigFields` dispatches this component by
 * key. Options come from the client-safe mirror of the engine's closed verb
 * union (`constants/effects.ts`); the def schema re-validates at save.
 */
import { FieldTitle } from "../../../../ui/field";
import type { ConfigFieldDef } from "../../../configFieldLogic";
import { EFFECT_LIFECYCLE_SECTIONS, type EffectLifecycle } from "@/constants/effects";
import { MultiCheckboxField } from "./MultiCheckboxField";

type EffectsValue = Partial<Record<EffectLifecycle, string[]>>;

export function EffectsConfigFields({
  field,
  value,
  onChange,
}: {
  field: ConfigFieldDef;
  value: unknown;
  onChange: (next: Record<string, unknown> | undefined) => void;
}) {
  const draft: EffectsValue =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as EffectsValue)
      : {};

  const write = (lifecycle: EffectLifecycle, selected: string[] | undefined) => {
    const next: Record<string, unknown> = { ...draft };
    if (selected?.length) next[lifecycle] = selected;
    else delete next[lifecycle];
    onChange(Object.keys(next).length ? next : undefined);
  };

  return (
    <div className="grid gap-2.5 rounded-lg border border-border p-3">
      <div className="grid gap-1">
        <FieldTitle>{field.label}</FieldTitle>
        {field.help && (
          <p className="text-[11px] text-muted-foreground m-0">{field.help}</p>
        )}
      </div>
      {EFFECT_LIFECYCLE_SECTIONS.map((section) => (
        <MultiCheckboxField
          key={section.key}
          field={{
            key: `effects.${section.key}`,
            label: section.label,
            help: section.help,
            options: [...section.verbs],
          }}
          selected={Array.isArray(draft[section.key]) ? draft[section.key] ?? [] : []}
          onChange={(v) =>
            write(section.key, Array.isArray(v) ? (v as string[]) : undefined)
          }
        />
      ))}
    </div>
  );
}
