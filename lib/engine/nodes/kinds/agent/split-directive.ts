import "server-only";

import type { AgentDef } from "../../declarative-schemas";

/**
 * The split directive (agent-node split plan §2.2): the short static block a
 * json-output agent prompt is appended with when the def declares `split` —
 * the same ONE-place pattern as `AgentOutputError.directive`, appended after
 * the output-contract directive. It tells the agent to produce items that are
 * unit-shaped: a stable `key_field` id and a `depends_on_field` ordering for
 * anything order-constrained. Files are mentioned only as a reason to declare
 * a dependency — file scopes themselves are item data, never contract.
 */
export function splitDirective(split: NonNullable<AgentDef["split"]>): string {
  return (
    `UNIT OUTPUT\n` +
    `  The items in your "${split.field}" array are units of work:\n` +
    `  1. Every item's "${split.key_field}" must be a stable, unique id — the same unit keeps the same id across re-runs, never a fresh random one.\n` +
    `  2. Set every item's "${split.depends_on_field}" to the ids of the units it must wait for — especially when two units touch the same files or other shared resources. Units without a declared dependency may run in parallel.\n`
  );
}
