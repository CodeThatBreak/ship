/**
 * Start-contract editing helpers: the contract's per-field rows as they flow
 * through the TS-lite schema box (`components/template-editor/ts-schema-lite`)
 * and the run-context enforcement (the waited event's variable). Kept separate
 * from the editor so the Trigger tab can read the contract fields without
 * rendering the editor.
 */
import type { StartContractField } from "@/types/start-contract";
import { WAIT_FOR_SOURCES } from "../constants";
import type { InputFieldRow } from "../ts-schema-lite";

/** Re-exported so configurator pieces never import the engine module directly
 *  (the documented client-bundle conflict — see docs/phase0-baseline.md). */
export type { StartContractField };

/** The start contract fields on the instance config (missing/invalid → none). */
export function contractFieldsOf(config: Record<string, unknown> | undefined): StartContractField[] {
  return Array.isArray(config?.contract) ? (config.contract as StartContractField[]) : [];
}/** The contract rows → the TS-lite authoring text (`key[?]: type;` members). */
export function startFieldsToTs(fields: StartContractField[]): string {
  return fields
    .map((f) => {
      const t = startFieldTypeTs(f.type);
      return `${f.key}${f.required ? "" : "?"}: ${t};`;
    })
    .join("\n");
}

/** A field type → the TS-lite member type (`array`→unknown[], `object`→Record). */
export function startFieldTypeTs(type: string): string {
  return type === "array"
    ? "unknown[]"
    : type === "object"
      ? "Record<string, unknown>"
      : type;
}

/** The compiled TS rows → contract fields; label/default carried over from
 *  the previous contract by key, so the per-field extras survive edits. */
export function buildStartContract(
  rows: InputFieldRow[],
  prev: StartContractField[],
): StartContractField[] {
  const prevByKey = new Map(prev.map((f) => [f.key, f]));
  const seen = new Set<string>();
  const out: StartContractField[] = [];
  for (const r of rows) {
    if (!r.key || seen.has(r.key)) continue;
    seen.add(r.key);
    const p = prevByKey.get(r.key);
    out.push({
      key: r.key,
      label: p?.label,
      type: r.type ?? "object",
      required: Boolean(r.required),
      default: p?.default,
    });
  }
  return out;
}

/** The run-context field the waited event publishes (MR / pipeline), if any. */
export function contextFieldKeyOf(waitFor: string | undefined): string | null {
  return waitFor
    ? (WAIT_FOR_SOURCES.find((w) => w.value === waitFor)?.contextField?.key ??
        null)
    : null;
}

/**
 * Enforce the waited event's variable on the run context: present and
 * required while its source is selected (kept in place if the author
 * declared it themselves; prepended when missing). The author never has to
 * write it in the schema box.
 */
export function withContextFields(
  fields: StartContractField[],
  waitFor: string | undefined,
): StartContractField[] {
  const cf = waitFor
    ? WAIT_FOR_SOURCES.find((w) => w.value === waitFor)?.contextField
    : undefined;
  if (!cf) return fields;
  const idx = fields.findIndex((f) => f.key === cf.key);
  if (idx === -1)
    return [{ key: cf.key, type: cf.type, required: true }, ...fields];
  if (fields[idx].required) return fields;
  const next = [...fields];
  next[idx] = { ...fields[idx], required: true };
  return next;
}
