import "server-only";

import { AGENT_OUTPUT_ERROR, AgentOutputError } from "../../shared/agent/outputError/outputErrorExports";
import type { SplitUnit } from "../../shared/nodeSharedExports";
import type { AgentDef } from "../../declarativeSchemas";

/**
 * The agent kind's split-source mapping (agent-node split plan §2.1, Phase 3):
 * the validated output's array at `split.field` mapped into split units. Pure
 * and stateless — the node reads its own recorded output and answers "here
 * are my units"; the split runtime owns expansion, scheduling and join.
 * Invariant upheld: the items are schema-validated data by construction (the
 * output contract was already enforced by `applyOutput`) — NO second
 * validation pass, only the unit-shape checks the split directive declared.
 * Must never spawn anything and never silently skip a malformed unit — a
 * producer error is loud, shaped exactly like an output-contract miss.
 */

/** The loud producer failure, shaped exactly like an output-contract miss
 *  (the engine serializes the standard payload into the trail). */
const splitUnitsError = (label: string, message: string, offending: unknown): AgentOutputError =>
  new AgentOutputError({
    code: AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
    label,
    message: `${label}: ${message}`,
    issues: [],
    response: JSON.stringify(offending ?? null),
  });

/** One validated output item → a SplitUnit (see agentSplitUnits for the rules). */
const unitOf = (
  split: NonNullable<AgentDef["split"]>,
  item: unknown,
  index: number,
  label: string,
): SplitUnit => {
  if (item == null || typeof item !== "object" || Array.isArray(item)) {
    throw splitUnitsError(label, `split field "${split.field}" item ${index} is not an object`, item);
  }
  const record = item as Record<string, unknown>;
  const key = record[split.key_field];
  if (typeof key !== "string" || !key.trim()) {
    throw splitUnitsError(
      label,
      `item ${index} has no usable "${split.key_field}" — every unit needs a stable, non-empty key`,
      item,
    );
  }
  const rawDeps = record[split.depends_on_field];
  const dependsOn: string[] = [];
  if (rawDeps != null) {
    if (!Array.isArray(rawDeps)) {
      throw splitUnitsError(label, `item ${index}'s "${split.depends_on_field}" must be an array of unit keys`, item);
    }
    for (const dep of rawDeps) {
      if (typeof dep !== "string" || !dep.trim()) {
        throw splitUnitsError(label, `item ${index}'s "${split.depends_on_field}" must be an array of unit keys`, item);
      }
      dependsOn.push(dep);
    }
  }
  const override = split.target_field != null ? record[split.target_field] : undefined;
  const target = typeof override === "string" && override.trim() ? override : split.target;
  return {
    key,
    // title: the item's string `title` when it declares one, else the key
    title: typeof record.title === "string" && record.title.trim() ? record.title : key,
    dependsOn,
    ...(target != null ? { target } : {}),
    item,
  };
};

/**
 * Map the validated output's array at `split.field` into units — the node's
 * split-source port body, extracted so the node stays a thin orchestrator.
 *
 * - No array at `split.field`, or an empty array → null (the node is not a
 *   source for this run — no expansion).
 * - Mapping: `key` ← `item[key_field]`; `title` ← the item's string `title`
 *   field when present, else the key (deliberately simple and deterministic —
 *   no fallback chain, §2.9); `dependsOn` ← `item[depends_on_field]`
 *   (default []); `target` ← the split default, overridden per item by
 *   `item[target_field]` when set; `item` rides verbatim.
 * - A malformed array (non-array at the field, non-object item, missing or
 *   non-string key, non-string[] dependencies) is a producer error — loud,
 *   like a contract failure: the same {@link AgentOutputError} payload
 *   applyOutput throws (code `schema_mismatch`), since these shapes all
 *   violate the unit contract the split directive declared.
 *
 * @param split - The def's declared split config (the caller checked it exists).
 * @param output - The node's PARSED recorded output (the caller owns the raw
 *   JSON-blob → record decode; `parseConfigSnapshot` yields `{}` for a
 *   missing/unreadable blob → no array → null, no expansion).
 * @param label - The node's label, for the error payload's identity fields.
 */
export const agentSplitUnits = (
  split: NonNullable<AgentDef["split"]>,
  output: Record<string, unknown>,
  label: string,
): SplitUnit[] | null => {
  const raw = output[split.field];
  if (raw == null) return null;
  if (!Array.isArray(raw)) {
    throw splitUnitsError(
      label,
      `split field "${split.field}" must be an array of unit items (got ${typeof raw})`,
      raw,
    );
  }
  if (!raw.length) return null;
  return raw.map((item, index) => unitOf(split, item, index, label));
};
