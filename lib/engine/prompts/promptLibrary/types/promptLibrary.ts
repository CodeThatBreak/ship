import "server-only";

import type { PromptBlock, PromptTemplate } from "../../promptDefaults";

export type PromptCtx = Record<string, string | undefined>;

/** One rendered internal block — the modal shows these with char counts. */
export interface RenderedBlock {
  kind: PromptBlock["kind"];
  text: string;
}

/**
 * The two-part assembly of one node prompt:
 *   body (user's) → internal blocks (engine rules + locked output contract +
 *   run data). `final` is exactly what the agent receives.
 */
export interface PromptAssembly {
  body: string;
  blocks: RenderedBlock[];
  final: string;
}

/** The prompt modal's display shape: the user's part vs the engine's locked parts. */
export interface PromptSections {
  /** the editable body — modal textarea seed */
  body: string;
  /** engine-authored rules, rendered — shown locked in the modal */
  engineRules: string;
  /** the machine-parsed output contract, rendered — shown locked in the modal */
  outputContract: string;
  /** live run-data blocks (context, diffs, logs, comments) — finalized at run time */
  runData: RenderedBlock[];
  /** exactly what the agent receives */
  final: string;
}

export type { PromptBlock, PromptTemplate };
