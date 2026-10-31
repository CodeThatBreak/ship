"use client";
/**
 * The agent's "Split into units" block (agent-node split plan Phase 3): the
 * enable checkbox plus the per-knob editors a plain ConfigField can't express
 * — the output-schema array-field PICKER (options derived from the compiled
 * `output_schema` the contract query returns: top-level array fields only — a
 * unit source iterates an array) and the per-item field paths, validated live
 * against the array's element shape. The default `target` is a free string
 * (node key or template id); its resolution is checked server-side at
 * template save (template-lint), where the node/template registries live —
 * the UI stays thin.
 */
import { useMemo } from "react";
import { Checkbox } from '../../../../ui/checkbox';
import { Input } from '../../../../ui/input';
import { Field } from '../../../../ui/field';
import { describeDefault, type ConfigFieldDef } from '../../../configFieldLogic';
import { ConfigSelect } from "./ConfigSelect";
import { FieldHeading } from "./FieldHeading";

/** The nested `split` object as the def schema declares it — here only the
 *  keys the editors read/write (defaults live in AgentDefSchema). */
interface SplitDraft {
  field?: string;
  key_field?: string;
  target?: string;
  target_field?: string;
  depends_on_field?: string;
}

/** The subset of a compiled JSON Schema this component navigates. */
interface SchemaNode {
  type?: string | string[];
  properties?: Record<string, unknown>;
  items?: SchemaNode;
}

function schemaType(s: unknown): string | null {
  if (!s || typeof s !== "object") return null;
  const t = (s as SchemaNode).type;
  if (Array.isArray(t)) return t[0] ?? null;
  return typeof t === "string" ? t : null;
}

/** The top-level ARRAY fields of the compiled output schema — the picker's
 *  options. Empty when the schema declares no properties (unknown shape). */
function arrayFieldsOf(output: unknown): string[] {
  const props = schemaNode(output)?.properties;
  if (!props) return [];
  return Object.entries(props)
    .filter(([, s]) => schemaType(s) === "array")
    .map(([key]) => key);
}

/** The element-shape keys of one array field — null when the field isn't an
 *  array there or its items declare no properties (unknown → free pass). */
function elementKeysOf(output: unknown, field: string): string[] | null {
  const props = schemaNode(output)?.properties;
  if (!props) return null;
  const elementProps = schemaNode(props[field])?.items?.properties;
  if (!elementProps || !Object.keys(elementProps).length) return null;
  return Object.keys(elementProps);
}

function schemaNode(v: unknown): SchemaNode | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as SchemaNode) : null;
}

export function SplitConfigFields({
  field,
  split,
  output,
  onSplitChange,
}: {
  /** the ConfigField entry (label + help) this block renders for */
  field: ConfigFieldDef;
  /** the config's current `split` value (absent = split off) */
  split: unknown;
  /** the node's output contract — the compiled output_schema for json output */
  output: unknown;
  /** writes the whole nested split object (undefined removes it) */
  onSplitChange: (next: Record<string, unknown> | undefined) => void;
}) {
  const draft = (schemaNode(split) ?? {}) as SplitDraft;
  const on = split != null;
  const arrayFields = useMemo(() => arrayFieldsOf(output), [output]);
  const schemaKnown = schemaNode(output)?.properties != null;
  const fieldKey = typeof draft.field === "string" ? draft.field : "";
  const elementKeys = useMemo(
    () => (fieldKey ? elementKeysOf(output, fieldKey) : null),
    [output, fieldKey],
  );

  // authoring-time field errors (server lint re-checks authoritatively at save)
  const fieldError =
    on && !fieldKey
      ? "Pick the output-schema array field to iterate — a unit source publishes its units from an array."
      : schemaKnown && fieldKey && !arrayFields.includes(fieldKey)
        ? `"${fieldKey}" is not an array in the output schema — pick one of: ${arrayFields.join(", ") || "(none declared)"}`
        : null;
  const pathError = (key: keyof SplitDraft, label: string): string | null => {
    const v = draft[key];
    if (elementKeys == null || typeof v !== "string" || !v) return null;
    return elementKeys.includes(v)
      ? null
      : `"${v}" is not a field of the "${fieldKey}" items — known element fields: ${elementKeys.join(", ") || "(none declared)"}${label ? ` (${label})` : ""}`;
  };

  const write = (key: keyof SplitDraft, v: string | undefined) => {
    const next: Record<string, unknown> = { ...draft };
    if (v == null || v === "") delete next[key];
    else next[key] = v;
    onSplitChange(next);
  };
  const pathInput = (key: keyof SplitDraft, label: string, help: string, placeholder: string) => {
    const id = `split-${key}`;
    return (
      <Field>
        <FieldHeading field={{ key: `split.${key}`, label, help }} htmlFor={id} />
        <Input
          id={id}
          value={typeof draft[key] === "string" ? draft[key] : ""}
          onChange={(e) => write(key, e.target.value || undefined)}
          placeholder={placeholder}
          className="font-mono text-[12.5px]"
        />
        {pathError(key, label) && (
          <p className="text-[11px] text-destructive m-0">{pathError(key, label)}</p>
        )}
      </Field>
    );
  };

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <label className="flex items-center gap-2 text-[13px] cursor-pointer">
          <Checkbox
            checked={on}
            onCheckedChange={(v) => {
              if (v !== true) {
                onSplitChange(undefined);
                return;
              }
              if (!on) onSplitChange({}); // enabling with nothing set — the field error below guides the author
            }}
          />
          <span>{field.label}</span>
        </label>
        {field.help && <p className="text-[11px] text-muted-foreground m-0">{field.help}</p>}
      </div>
      {on && (
        <>
          <Field>
            <FieldHeading
              field={{ key: "split.field", label: "Array field", help: "The output-schema array whose items become the units" }}
              htmlFor="split-field"
            />
            {arrayFields.length ? (
              <ConfigSelect
                options={arrayFields.map((f) => ({ value: f, label: f }))}
                effective={fieldKey}
                defaultLabel="(pick an array field)"
                id="split-field"
                onChange={(v) => write("field", typeof v === "string" ? v : undefined)}
              />
            ) : (
              <Input
                id="split-field"
                value={fieldKey}
                onChange={(e) => write("field", e.target.value || undefined)}
                placeholder="declare an array in the output schema first"
                className="font-mono text-[12.5px]"
              />
            )}
            {fieldError && <p className="text-[11px] text-destructive m-0">{fieldError}</p>}
          </Field>
          {pathInput("key_field", "Unit key field", "The item path holding the stable unit id", describeDefault("key"))}
          {pathInput(
            "depends_on_field",
            "Dependencies field",
            "The item path holding the unit keys that must run first",
            describeDefault("dependsOn"),
          )}
          {pathInput(
            "target_field",
            "Target override field",
            "The item path that overrides the default target per unit (heterogeneous routing)",
            describeDefault(undefined),
          )}
          <Field>
            <FieldHeading
              field={{ key: "split.target", label: "Default target", help: "Where units go by default" }}
              htmlFor="split-target"
            />
            <Input
              id="split-target"
              value={typeof draft.target === "string" ? draft.target : ""}
              onChange={(e) => write("target", e.target.value || undefined)}
              placeholder={describeDefault(undefined)}
              className="font-mono text-[12.5px]"
            />
            <p className="text-[11px] text-muted-foreground m-0">
              A builtin node key (e.g. build) or a node template id — resolved and checked at save.
            </p>
          </Field>
        </>
      )}
    </div>
  );
}
