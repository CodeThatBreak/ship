"use client";
/**
 * The `ts_output` renderer: the TS-lite schema box, writing the compiled
 * schema plus its `<key>_ts` companion authoring text.
 */
import { TsOutputEditor } from "../../contract/TsOutputEditor";
import type { ConfigFieldProps } from "../types/configFieldProps";

export const TsOutputFieldRenderer = ({
  field,
  value,
  defaultValue,
  companionText,
  onChange,
}: ConfigFieldProps) => (
  <TsOutputEditor
    field={field}
    value={value}
    defaultValue={defaultValue}
    savedText={typeof companionText === "string" ? companionText : undefined}
    onChange={(schema, saved) =>
      onChange(schema, { [`${field.key}_ts`]: saved })
    }
  />
);
