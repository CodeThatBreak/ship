"use client";
/** The `map` renderer: the decision pass-down variable map editor. */
import { PassMapEditor } from "../../passMap/PassMapEditor";
import type { ConfigFieldProps } from "../types/configFieldProps";

export const MapFieldRenderer = ({
  field,
  value,
  defaultValue,
  varGroups,
  templateId,
  onChange,
}: ConfigFieldProps) => (
  <PassMapEditor
    field={field}
    value={value}
    defaultValue={defaultValue}
    varGroups={varGroups}
    templateId={templateId}
    onChange={onChange}
  />
);
