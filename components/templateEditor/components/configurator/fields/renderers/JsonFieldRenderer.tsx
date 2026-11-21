"use client";
/**
 * The `json` renderer: the JSON box with the "Variables ▾" picker beside the
 * heading and the http secrets chips under it.
 */
import { Field } from "../../../../../ui/field";
import { VariablesPicker } from "../../prompt/VariablesPicker";
import { ConfigJsonField } from "../ConfigJsonField";
import { FieldHeading } from "../FieldHeading";
import { SecretsChipGroup } from "../SecretsChipGroup";
import { appendConfigRef, effectiveConfigValue } from "../../../../configFieldLogic";
import type { ConfigFieldProps } from "../types/configFieldProps";

export const JsonFieldRenderer = ({
  field,
  value,
  defaultValue,
  secrets,
  varGroups,
  onChange,
}: ConfigFieldProps) => {
  const insertRef = (ref: string) => {
    onChange(appendConfigRef(typeof value === "string" ? value : "", ref));
  };
  return (
    <Field>
      <div className="flex items-center justify-between gap-2">
        <FieldHeading field={field} htmlFor={`config-${field.key}`} />
        {varGroups?.length ? (
          <VariablesPicker groups={varGroups} onInsert={insertRef} />
        ) : null}
      </div>
      <ConfigJsonField
        key={field.key}
        controlId={`config-${field.key}`}
        effective={effectiveConfigValue(value, defaultValue)}
        defaultValue={defaultValue}
        onChange={onChange}
      />
      {secrets != null && (
        <SecretsChipGroup names={secrets} onInsert={insertRef} />
      )}
    </Field>
  );
};
