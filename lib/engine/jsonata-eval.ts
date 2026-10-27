/**
 * Server re-export of the JSONata evaluator's single implementation, which
 * now lives in the client-safe module
 * `components/template-editor/condition-builder/jsonata-eval.ts` (pure — no
 * store / engine imports — trusted in the browser bundle for the template
 * editor's compile checks; see docs/phase0-baseline.md conflict notes).
 *
 * Engine code keeps importing from here (`./jsonata-eval`, `../../jsonata-eval`,
 * …); this file is the one dedicated seam pointing the server tree at the
 * shared module. Flagged in the refactor report: lib → components/ import,
 * accepted so the evaluator has exactly one source of truth.
 */
export {
  evalJsonata,
  jsonataTruthy,
  jsonataFail,
  lintJsonata,
  templateRefs,
  type EvalResult,
} from "@/components/template-editor/condition-builder/jsonata-eval";
