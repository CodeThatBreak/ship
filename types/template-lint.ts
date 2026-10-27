/**
 * Client-safe re-export of the template linter's problem shape — the same
 * pattern as types/model-spec.ts: the client editor displays LintProblems but
 * must not import the server lib module that defines them (the linter's value
 * code stays server-side; the messages arrive via POST /api/templates/[id]/validate).
 */
export type { LintProblem } from "@/lib/engine/templates/template-lint";
