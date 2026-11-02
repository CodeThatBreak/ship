"use client";
/**
 * The plain configure-field layout, extracted from ConfigFieldRow.tsx: the
 * heading bound to the control through `htmlFor` with the "Variables ▾"
 * picker beside it, the knob's control (the rich select / the text / string /
 * number boxes), and the http secrets chip group under the field when the
 * caller configured them (Phase 6).
 */
import { Input } from '../../../../ui/input';
import { Field } from '../../../../ui/field';
import { Textarea } from '../../../../ui/textarea';
import { VariablesPicker } from '../prompt/VariablesPicker';
import { SecretsChipGroup } from "./SecretsChipGroup";
import { ConfigSelect } from "./ConfigSelect";
import { FieldHeading } from "./FieldHeading";
import { describeDefault, type ConfigFieldDef } from '../../../configFieldLogic';
import type { VarGroup } from '../../../variables';

export function ConfigPlainField({
  field,
  effective,
  defaultValue,
  secrets,
  varGroups,
  insertRef,
  onChange,
}: {
  field: ConfigFieldDef;
  /** the effective value — the override, else the catalog/class default */
  effective: unknown;
  /** the catalog/class default (shown as placeholder when no override is set) */
  defaultValue?: unknown;
  /** configured secret names (Phase 6, http nodes) — undefined hides the chip group */
  secrets?: string[];
  /** the grouped variable vocabulary (Phase 3) — empty hides the picker */
  varGroups?: VarGroup[];
  insertRef: (ref: string) => void;
  onChange: (v: unknown) => void;
}) {
  const CONFIG_CONTROL_ID = `config-${field.key}`;
  const picker = varGroups?.length ? (
    <VariablesPicker groups={varGroups} onInsert={insertRef} />
  ) : null;
  const control =
    field.type === "select" ? (
      <ConfigSelect
        options={field.options ?? []}
        optionIcons={field.optionIcons}
        effective={effective}
        defaultValue={defaultValue}
        defaultLabel={describeDefault(defaultValue)}
        id={CONFIG_CONTROL_ID}
        onChange={onChange}
      />
    ) : field.type === "text" ? (
      <Textarea
        id={CONFIG_CONTROL_ID}
        value={
          typeof effective === "string"
            ? effective
            : effective != null
              ? JSON.stringify(effective, null, 2)
              : ""
        }
        onChange={(e) => onChange(e.target.value || undefined)}
        rows={5}
        className="font-mono text-[12px]"
        placeholder={describeDefault(defaultValue)}
      />
    ) : field.type === "string" ? (
      <Input
        id={CONFIG_CONTROL_ID}
        value={typeof effective === "string" ? effective : ""}
        onChange={(e) =>
          onChange(
            e.target.value === "" && field.nullable
              ? null // "cleared" the override — don't snap back to the default
              : e.target.value || undefined,
          )
        }
        placeholder={describeDefault(defaultValue)}
        className="font-mono text-[12.5px]"
      />
    ) : (
      <Input
        id={CONFIG_CONTROL_ID}
        type="number"
        value={typeof effective === "number" ? effective : ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? undefined : Number(e.target.value))
        }
        placeholder={describeDefault(defaultValue)}
      />
    );
  return (
    <Field>
      <div className="flex items-center justify-between gap-2">
        <FieldHeading field={field} htmlFor={CONFIG_CONTROL_ID} />
        {picker}
      </div>
      {control}
      {secrets != null && (
        <SecretsChipGroup names={secrets} onInsert={insertRef} />
      )}
    </Field>
  );
}
