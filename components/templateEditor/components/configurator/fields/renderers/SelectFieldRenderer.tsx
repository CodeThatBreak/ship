"use client";
/**
 * The `select` renderer: the fan-out child knob gets the gallery picker
 * (Phase 3C — flow templates excluding hidden auto-wrapped child templates,
 * for built-in and declarative parents; empty = auto-select), every other
 * select gets the plain rich select.
 */
import { Field } from "../../../../../ui/field";
import { FanoutChildPicker } from "../../FanoutChildPicker";
import { FieldHeading } from "../FieldHeading";
import { PlainFieldRenderer } from "./PlainFieldRenderer";
import { CONFIG_FIELD_KEY } from "../constants/configFieldKeys";
import { effectiveConfigValue } from "../../../../configFieldLogic";
import type { ConfigFieldProps } from "../types/configFieldProps";

export const SelectFieldRenderer = (props: ConfigFieldProps) => {
  const { field, value, defaultValue, onChange } = props;
  if (field.key !== CONFIG_FIELD_KEY.FANOUT_CHILD) {
    return <PlainFieldRenderer {...props} />;
  }
  const effective = effectiveConfigValue(value, defaultValue);
  return (
    <Field>
      <FieldHeading field={field} />
      <FanoutChildPicker
        value={typeof effective === "string" ? effective : ""}
        onChange={(v) => onChange(v || undefined)}
      />
    </Field>
  );
};
