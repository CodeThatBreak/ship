"use client";
/**
 * The `text` renderer: the http response map gets the live JSONata editor
 * (Phase 5 — evaluated against the response object, so its vocabulary and
 * preview scope differ), prompt fields get the rich prompt editor ("@" opens
 * the grouped variable popover, unresolvable refs underline where typed),
 * and every other text knob gets the plain textarea.
 */
import { Field } from "../../../../../ui/field";
import { ExpressionInput } from "../../../../conditionBuilder/ExpressionInput";
import { PromptEditor } from "../../prompt/PromptEditor";
import { FieldHeading } from "../FieldHeading";
import { PlainFieldRenderer } from "./PlainFieldRenderer";
import { CONFIG_FIELD_KEY } from "../constants/configFieldKeys";
import { effectiveConfigValue, promptEditorKeys } from "../../../../configFieldLogic";
import type { ConfigFieldProps } from "../types/configFieldProps";

export const TextFieldRenderer = (props: ConfigFieldProps) => {
  const { field, value, defaultValue, varGroups, invalidRefs, templateId, onChange } = props;
  const effective = effectiveConfigValue(value, defaultValue);
  if (field.key === CONFIG_FIELD_KEY.RESPONSE_MAP) {
    return (
      <Field>
        <FieldHeading field={field} />
        <ExpressionInput
          value={typeof effective === "string" ? effective : ""}
          varGroups={varGroups}
          templateId={templateId}
          scope="response"
          rows={3}
          placeholder={
            "body.result — must yield an object ({status, ok, body, headers} is the raw response)"
          }
          onChange={(v) => onChange(v.trim() ? v : null)}
        />
      </Field>
    );
  }
  if (promptEditorKeys.has(field.key)) {
    return (
      <Field>
        <FieldHeading field={field} />
        <PromptEditor
          value={typeof effective === "string" ? effective : ""}
          groups={varGroups ?? []}
          invalidRefs={invalidRefs}
          onChange={(text) => onChange(text || undefined)}
        />
      </Field>
    );
  }
  return <PlainFieldRenderer {...props} />;
};
