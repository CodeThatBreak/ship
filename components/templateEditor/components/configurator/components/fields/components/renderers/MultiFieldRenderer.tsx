"use client";
/** The `multi` renderer: the checkbox group writing a string array. */
import { MultiCheckboxField } from "../MultiCheckboxField";
import { effectiveConfigValue } from "../../../../../../configFieldLogic";
import type { ConfigFieldProps } from "../../types/configFieldProps";

export const MultiFieldRenderer = ({
  field,
  value,
  defaultValue,
  onChange,
}: ConfigFieldProps) => {
  const effective = effectiveConfigValue(value, defaultValue);
  return (
    <MultiCheckboxField
      field={field}
      selected={Array.isArray(effective) ? (effective as string[]) : []}
      onChange={onChange}
    />
  );
};
