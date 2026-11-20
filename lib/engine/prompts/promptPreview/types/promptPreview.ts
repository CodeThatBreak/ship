import type { PromptSections } from "../../promptLibrary/types/promptLibrary";
import type { PromptSource } from "../../../nodes/shared/nodeSharedExports";

/**
 * The prompt modal's truth layer (Phase 1): the live prompt resolution —
 * assembled by the node def's own `previewPrompt` from its template + config
 * knobs — plus the last-run overlay read from `nodes.input.prompt`.
 *
 * The modal never shows a stale per-run "override" instead of the live
 * resolution (the veto the old route gave `nodes.promptOverride` is gone):
 * the response carries BOTH the current final prompt and what the last run
 * actually sent, with a `diverges` flag so the UI can flag the difference.
 */

/** The full modal payload: back-compat fields plus the three-part sections. */
export interface PromptPreviewPayload {
  // back-compat: the editable body (the modal's textarea seed / reset target)
  prompt: string;
  label: string;
  description: string;
  variables: string[];
  mode: string;
  source: "template";
  appendsInternal: boolean;
  // three-part sections
  bodySource: "config" | "default";
  engineRules: string;
  outputContract: string;
  runData: PromptSections["runData"];
  final: string;
  finalChars: number;
  // last-run overlay (Phase 1): what run N actually sent, read from
  // nodes.input.prompt, and whether it diverges from the current resolution
  lastRun: string | null;
  diverges: boolean;
  /**
   * Why the last run's prompt diverges from the current resolution (step 05):
   * `"template-edited"` — a body/rules/contract section changed since the run
   * (template edit or config body change); `"run-data"` — the template
   * resolution is intact and only the run-data slots differ. Undefined when
   * nothing diverges.
   */
  divergesReason?: "template-edited" | "run-data";
  /** where the last run's prompt came from (recorded for agent kinds, inferred from the config knob for built-ins) */
  promptSource: PromptSource;
}

/** The failure member both reads share (the routes map it to an HTTP status). */
export type PromptFailure = { ok: false; status: number; error: string };

export type PromptPreviewResult =
  | { ok: true; payload: PromptPreviewPayload }
  | PromptFailure;

/** The composer's bulk prompt read — every promptable node body, keyed by node key. */
export type AllPromptsResult =
  | { ok: true; prompts: Record<string, string> }
  | PromptFailure;
