"use client";
/**
 * The agent's output schema editor — the presentational half extracted from
 * ConfigFieldRow.tsx: the TS-lite authoring box (or a pasted JSON Schema)
 * that compiles to the `output_schema` the json output is validated against.
 * The raw authoring text rides along in the config (`<key>_ts`): the
 * compiled schema is what the runtime uses, but the box re-seeds to what the
 * author wrote — format/tab switches remount the field without the authoring
 * source turning into JSON. Draft state + compilation come from
 * `useOutputSchemaDraft`.
 */
import { Card } from "../../ui/card";
import { Field, FieldLabel } from "../../ui/field";
import { Textarea } from "../../ui/textarea";
import { useOutputSchemaDraft } from "../hooks/useOutputSchemaDraft";
import type { ConfigFieldDef } from "../configFieldLogic";

export function TsOutputEditor({
  field,
  value,
  defaultValue,
  savedText,
  onChange,
}: {
  field: ConfigFieldDef;
  value: unknown;
  defaultValue?: unknown;
  /** the previously persisted authoring text — seed source on mount */
  savedText?: string;
  /** the compiled schema (undefined = cleared) + the raw authoring text */
  onChange: (schema: unknown, saved: string | undefined) => void;
}) {
  const { text, setText, err } = useOutputSchemaDraft({
    value,
    defaultValue,
    savedText,
    onChange,
  });
  return (
    <Field>
      <FieldLabel htmlFor={`config-${field.key}`}>{field.label}</FieldLabel>
      <Textarea
        id={`config-${field.key}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        className="font-mono text-[12px]"
        placeholder={`{\n  summary: string\n  severity: "low" | "high"\n  files: string[]\n}`}
      />
      {err && (
        <Card className="p-2.5 text-[12px] text-destructive border-destructive/30">
          {err}
        </Card>
      )}
    </Field>
  );
}
