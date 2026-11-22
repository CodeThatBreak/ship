"use client";
/** The `choices` renderer: the decision branch editor. */
import { ChoicesEditor } from "../../../choices/ChoicesEditor";
import type { ConfigFieldProps } from "../../types/configFieldProps";

export const ChoicesFieldRenderer = ({
  value,
  defaultValue,
  decisionSource,
  varGroups,
  templateId,
  onChange,
}: ConfigFieldProps) => (
  <ChoicesEditor
    value={value}
    defaultValue={defaultValue}
    source={decisionSource}
    varGroups={varGroups}
    templateId={templateId}
    onChange={onChange}
  />
);
