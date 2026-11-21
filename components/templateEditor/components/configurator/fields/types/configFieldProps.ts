import type { ConfigFieldDef } from "../../../../configFieldLogic";
import type { VarGroup } from "../../../../variables";

/** One config knob's row props — every registered field renderer takes these. */
export type ConfigFieldProps = {
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
};
