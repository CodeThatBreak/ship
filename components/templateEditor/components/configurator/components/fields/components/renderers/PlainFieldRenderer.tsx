"use client";
/**
 * The `string` / `number` renderer and the registry's fallback for an
 * unregistered type: the plain configure-field layout with the "Variables ▾"
 * picker and the http secrets chips.
 */
import { ConfigPlainField } from "../ConfigPlainField";
import { appendConfigRef, effectiveConfigValue } from "../../../../../../configFieldLogic";
import type { ConfigFieldProps } from "../../types/configFieldProps";

export const PlainFieldRenderer = ({
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
    <ConfigPlainField
      field={field}
      effective={effectiveConfigValue(value, defaultValue)}
      defaultValue={defaultValue}
      secrets={secrets}
      varGroups={varGroups}
      insertRef={insertRef}
      onChange={onChange}
    />
  );
};
