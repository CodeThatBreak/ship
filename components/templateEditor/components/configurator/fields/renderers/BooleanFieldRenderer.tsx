"use client";
/** The `boolean` renderer: one labelled checkbox. */
import { Checkbox } from "../../../../../ui/checkbox";
import { effectiveConfigValue } from "../../../../configFieldLogic";
import type { ConfigFieldProps } from "../types/configFieldProps";

export const BooleanFieldRenderer = ({
  field,
  value,
  defaultValue,
  onChange,
}: ConfigFieldProps) => (
  <label className="flex items-center gap-2 text-[13px] cursor-pointer">
    <Checkbox
      checked={effectiveConfigValue(value, defaultValue) === true}
      onCheckedChange={(v) => onChange(v === true)}
    />
    <span>{field.label}</span>
  </label>
);
