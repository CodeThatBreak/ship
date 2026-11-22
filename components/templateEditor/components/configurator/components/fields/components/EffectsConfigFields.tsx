"use client";
/**
 * The declarative `effects` block: one checkbox group per lifecycle. It is a
 * nested object (the split block's precedent), so a plain ConfigField row
 * can't express it — `DeclarativeConfigFields` dispatches this component by
 * key. Options come from the client-safe mirror of the engine's closed verb
 * union (`constants/effects.ts`); the def schema re-validates at save.
 */
import { Checkbox } from "../../../../../../ui/checkbox";
import { Field, FieldLabel } from "../../../../../../ui/field";
import type { ConfigFieldDef } from "../../../../../configFieldLogic";
import { EFFECT_LIFECYCLE_SECTIONS, type EffectLifecycle } from "@/constants/effects";

type EffectsValue = Partial<Record<EffectLifecycle, string[]>>;

export function EffectsConfigFields({
  value,
  onChange,
}: {
  /** kept for call-site symmetry — the field's own label/help are deliberately
   *  not rendered; the section label and verb label carry all the wording */
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
    <div className="grid gap-2.5">
      {EFFECT_LIFECYCLE_SECTIONS.map((section) => {
        const selected = Array.isArray(draft[section.key])
          ? draft[section.key] ?? []
          : [];
        return (
          <Field key={section.key}>
            <FieldLabel>{section.label}</FieldLabel>
            <div className="grid gap-1.5 rounded-lg border border-border p-2">
              {section.verbs.map((verb) => (
                <label
                  key={verb.value}
                  className="flex items-center gap-2 text-[12.5px] cursor-pointer"
                >
                  <Checkbox
                    checked={selected.includes(verb.value)}
                    onCheckedChange={(checked) =>
                      write(
                        section.key,
                        checked === true
                          ? [...selected, verb.value]
                          : selected.filter((v) => v !== verb.value),
                      )
                    }
                  />
                  <span className="leading-tight">{verb.label}</span>
                </label>
              ))}
            </div>
          </Field>
        );
      })}
    </div>
  );
}
