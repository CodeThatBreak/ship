/**
 * The config-field editing logic (Phase 2 → 6), extracted from
 * ConfigFieldRow.tsx: the field-key vocabularies that route a knob to its
 * bespoke editor, and the pure read/write helpers over the config object.
 * Pure module — the UI lives in `components/`, data hooks in `hooks/`.
 */
import {
  asJsonataGroups,
  conditionVarGroups,
  type VarGroup,
} from "./variables";

/** One config knob, as the built-in and declarative kinds declare them —
 *  one ConfigFieldRow per knob. */
export interface ConfigFieldDef {
  key: string;
  label: string;
  type: string;
  help?: string;
  options?: { value: string; label: string; description?: string }[];
  optionIcons?: Record<string, string>;
  nullable?: boolean;
}

/** config fields authored with the rich prompt editor ("@" variable popover)
 *  — `question` is the decision agent's prompt */
export const promptEditorKeys = new Set([
  "prompt",
  "prompt_body",
  "fix_prompt_body",
  "question",
]);

/** The config knob a prompt field's standing rules ride (`prompt_rules`,
 *  `fix_prompt_rules`) — undefined for prompts without a rules knob. */
export function rulesKeyFor(promptKey: string): string | undefined {
  if (promptKey === "fix_prompt_body") return "fix_prompt_rules";
  if (promptKey === "prompt_body") return "prompt_rules";
  return undefined;
}

/** config knobs that carry {{...}} template refs — they get the "Variables ▾" picker */
export const freeTextFields = new Set([
  "prompt",
  "prompt_body",
  "fix_prompt_body",
  "model",
  "url",
  "body",
  "question",
]);

/** The http fields where `{{secrets.NAME}}` resolves (Phase 6) — they get the
 *  configured-secrets chip group under the input. */
export const secretFields = new Set(["url", "headers", "body"]);

/**
 * The node's vocabulary as the condition/expression editors' groups (Phase 5):
 * brace-stripped, minus "My inputs" (the flow context map has no `input`
 * root — conditions and pass maps see task / upstream / trigger / flow /
 * repo), plus the flow & repo group.
 */
export function condVarGroups(groups?: VarGroup[]): VarGroup[] {
  return asJsonataGroups(conditionVarGroups(groups ?? []));
}

/**
 * The companion key an editor writes alongside its compiled value — the
 * `ts_output` box stores the raw TypeScript members the author typed
 * (`<key>_ts`), so the box re-seeds to their source instead of the compiled
 * JSON Schema after a remount (format switches, tab switches, node changes).
 * An instance without an override falls back to the catalog def's companion
 * (the create dialog persists its box text on the def).
 */
export function companionTextOf(
  config: Record<string, unknown> | undefined,
  key: string,
  defaultValue?: unknown,
): unknown {
  const own = config?.[`${key}_ts`];
  if (own !== undefined) return own;
  return (defaultValue as Record<string, unknown> | undefined)?.[`${key}_ts`];
}

/** The config object after one field edit: the written value plus any
 *  companion the editor carries along (undefined values drop out on
 *  persist — removing the override lets the catalog default apply). */
export function writeConfig(
  config: Record<string, unknown> | undefined,
  key: string,
  v: unknown,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(config ?? {}), ...extra, [key]: v };
}

/** The value an inserted `{{...}}` ref lands on: appended after the current
 *  text (space-separated), or the ref alone when the field is empty. */
export function appendConfigRef(current: string, ref: string): string {
  return current ? (current.endsWith(" ") ? current : `${current} `) + ref : ref;
}

/** The placeholder hint for a knob's catalog/class default — the human
 *  "(default)" / "(default: …)" text under plain inputs and selects. */
export function describeDefault(v: unknown): string {
  if (v == null || v === "") return "(default)";
  if (typeof v === "string")
    return v.length > 60
      ? `(default: ${v.slice(0, 60)}…)`
      : `(default: ${v})`;
  return `(default: ${JSON.stringify(v)})`;
}
