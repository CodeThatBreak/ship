"use client";
/**
 * The schema-driven config field renderers (Phase 2 → 6): one `ConfigFieldRow`
 * per knob, dispatching on the field type to the bespoke editors —
 * TS-lite schema boxes, decision branch choices, pass-down variable maps,
 * the http secrets chips, the fan-out child picker, and the plain
 * string/number/boolean/select controls.
 *
 * Extracted from NodeConfigurator so any host surface can render a kind's
 * full definition form: the builder drawer's Config tab and the Template
 * Nodes page's create/configure dialog share this machinery (one editing
 * experience everywhere, and a new knob declared on a runtime class shows up
 * on both without extra wiring).
 *
 * Decomposed per component standards: the editors and presentational pieces
 * live in `components/`, their state hooks in `hooks/`, and the shared
 * field-key vocabularies + pure config helpers in `config-field-logic.ts`.
 * This module stays the public face — the re-exports below keep every
 * existing `./ConfigFieldRow` import (consumers + the feature barrel) valid.
 */
import { Checkbox } from "../ui/checkbox";
import { Field } from "../ui/field";
import { ExpressionInput } from "./conditionBuilder/conditionBuilderExports";
import { PromptEditor } from "./PromptEditor";
import { ChoicesEditor } from "./components/ChoicesEditor";
import { ConfigJsonField } from "./components/ConfigJsonField";
import { ConfigPlainField } from "./components/ConfigPlainField";
import { FanoutChildPicker } from "./components/FanoutChildPicker";
import { FieldHeading } from "./components/FieldHeading";
import { MultiCheckboxField } from "./components/MultiCheckboxField";
import { PassMapEditor } from "./components/PassMapEditor";
import { SecretsChipGroup } from "./components/SecretsChipGroup";
import { VariablesPicker } from "./components/VariablesPicker";
import { TsOutputEditor } from "./components/TsOutputEditor";
import {
  appendConfigRef,
  promptEditorKeys,
  type ConfigFieldDef,
} from "./configFieldLogic";
import type { VarGroup } from "./variables";

// facade: the consumers (NodeConfigurator, PromptTab, DeclarativeConfigFields)
// and the feature barrel import these from here
export { SelectOption } from "./components/SelectOption";
export { SecretsChipGroup } from "./components/SecretsChipGroup";
export { VariablesPicker } from "./components/VariablesPicker";
export {
  companionTextOf,
  freeTextFields,
  promptEditorKeys,
  rulesKeyFor,
  secretFields,
  writeConfig,
} from "./configFieldLogic";

export function ConfigFieldRow({
  field,
  value,
  defaultValue,
  companionText,
  decisionSource,
  secrets,
  varGroups,
  invalidRefs,
  templateId,
  onChange,
}: {
  field: ConfigFieldDef;
  value: unknown;
  /** the catalog/class default (shown as placeholder when no override is set) */
  defaultValue?: unknown;
  /** the companion authoring text (`<key>_ts`) the ts_output box persister stores */
  companionText?: unknown;
  /** a decision node's current source — the choices editor shows per-choice
   *  conditions for the expression source */
  decisionSource?: string;
  /** configured secret names (Phase 6, http nodes) — the {{secrets.NAME}}
   *  chip group under the field */
  secrets?: string[];
  /** the grouped variable vocabulary — the prompt editor's @ popover / the
   *  field's "Variables ▾" picker (Phase 3) */
  varGroups?: VarGroup[];
  /** live-linted refs → the linter's problem (prompt fields underline them) */
  invalidRefs?: Record<string, string>;
  /** the owning template's id (Phase 5) — the expression editors' preview */
  templateId?: string;
  onChange: (v: unknown, extra?: Record<string, unknown>) => void;
}) {
  const effective = value !== undefined ? value : defaultValue;
  // raw-JSONata text fields get the live expression editor (Phase 5): the
  // http response_map evaluates against the response object, not the flow
  // context — its vocabulary + preview scope differ accordingly
  if (field.type === "text" && field.key === "response_map") {
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
  // the declarative kinds' bespoke editors (schema boxes, branch choices)
  if (field.type === "ts_output") {
    return (
      <TsOutputEditor
        field={field}
        value={value}
        defaultValue={defaultValue}
        savedText={
          typeof companionText === "string" ? companionText : undefined
        }
        onChange={(schema, saved) =>
          onChange(schema, { [`${field.key}_ts`]: saved })
        }
      />
    );
  }
  if (field.type === "choices") {
    return (
      <ChoicesEditor
        value={value}
        defaultValue={defaultValue}
        source={decisionSource}
        varGroups={varGroups}
        templateId={templateId}
        onChange={onChange}
      />
    );
  }
  if (field.type === "map") {
    return (
      <PassMapEditor
        field={field}
        value={value}
        defaultValue={defaultValue}
        varGroups={varGroups}
        templateId={templateId}
        onChange={onChange}
      />
    );
  }
  if (field.type === "boolean") {
    return (
      <label className="flex items-center gap-2 text-[13px] cursor-pointer">
        <Checkbox
          checked={effective === true}
          onCheckedChange={(v) => onChange(v === true)}
        />
        <span>{field.label}</span>
      </label>
    );
  }
  if (field.type === "multi") {
    return (
      <MultiCheckboxField
        field={field}
        selected={Array.isArray(effective) ? (effective as string[]) : []}
        onChange={onChange}
      />
    );
  }
  // prompt fields: the rich text editor — "@" opens the grouped variable
  // popover, and unresolvable refs underline where they're typed
  if (field.type === "text" && promptEditorKeys.has(field.key)) {
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
  // fan-out child: the gallery picker (Phase 3C) — flow templates EXCLUDING
  // hidden auto-wrapped child templates, for both built-in and declarative
  // (agent-kind) parents; empty = auto-select (built-in step build / self-wrap)
  if (field.key === "fanout_child") {
    return (
      <Field>
        <FieldHeading field={field} />
        <FanoutChildPicker
          value={typeof effective === "string" ? effective : ""}
          onChange={(v) => onChange(v || undefined)}
        />
      </Field>
    );
  }
  const insertRef = (ref: string) => {
    onChange(appendConfigRef(typeof value === "string" ? value : "", ref));
  };
  if (field.type === "json") {
    return (
      <Field>
        <div className="flex items-center justify-between gap-2">
          <FieldHeading field={field} htmlFor={`config-${field.key}`} />
          {varGroups?.length ? (
            <VariablesPicker groups={varGroups} onInsert={insertRef} />
          ) : null}
        </div>
        <ConfigJsonField
          key={field.key}
          controlId={`config-${field.key}`}
          effective={effective}
          defaultValue={defaultValue}
          onChange={onChange}
        />
        {secrets != null && (
          <SecretsChipGroup names={secrets} onInsert={insertRef} />
        )}
      </Field>
    );
  }
  return (
    <ConfigPlainField
      field={field}
      effective={effective}
      defaultValue={defaultValue}
      secrets={secrets}
      varGroups={varGroups}
      insertRef={insertRef}
      onChange={onChange}
    />
  );
}
