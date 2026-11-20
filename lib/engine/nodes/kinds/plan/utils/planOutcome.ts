import 'server-only';

import type { NodeRow } from '../../../../../db/rows';
import type { RunOutcome } from '../../../shared/nodeSharedExports';
import type { PlanMeta } from '../schema';

/**
 * Pure outcome shapers for the plan contract — no I/O, no state. The
 * awaiting-approval event text and output blob produced here are the public
 * contract the UI and the approval flow read, so any change is
 * behavior-visible.
 */

/** Reads the model the turn was dispatched with from the node input, or null. */
export const readRunModel = (node: NodeRow): string | null => {
  const input = node.input as { model?: string | null } | null;
  if (!input || input.model == null) return null;
  return input.model;
};

/**
 * The whole-plan outcome: awaiting approval, the output blob pointing at the
 * fresh artifact version (the dispatching model echoed when present), and the
 * lifecycle event naming the version, branch count and step count.
 */
export const planOutcome = (
  art: { id: string; version: number },
  planMeta: PlanMeta,
  stepCount: number,
  text: string,
  model: string | null
): RunOutcome => {
  const branchNote = planMeta.branches.length
    ? ` (${planMeta.branches.length} branch${planMeta.branches.length > 1 ? 'es' : ''})`
    : '';
  const stepNote = stepCount ? ` · ${stepCount} steps` : '';
  return {
    status: 'awaiting_approval',
    output: {
      latestArtifact: art.id,
      version: art.version,
      ...(model != null ? { model } : {}),
      ...(planMeta.branches.length ? { branches: planMeta.branches } : {}),
      ...(planMeta.steps.length ? { steps: planMeta.steps } : {}),
    },
    event: `plan v${art.version} ready for review${branchNote}${stepNote}`,
    reply: text,
  };
};
