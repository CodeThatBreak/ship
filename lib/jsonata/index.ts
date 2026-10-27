/**
 * Shared JSONata evaluator barrel: the single import path for both the
 * engine runtime (server) and the template editor's client-side compile
 * checks. Deep paths across features are forbidden — import from here.
 */
export {
  evalJsonata,
  jsonataTruthy,
  jsonataFail,
  lintJsonata,
  templateRefs,
  type EvalResult,
} from "./eval";
