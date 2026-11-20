import "server-only";

/**
 * Thrown when a terminal outcome violates its node's declared output contract
 * (engine overhaul step 04, Invariant 5). The transition authority refuses to
 * publish: the caller maps the failure to a `failed` node with a typed
 * `output_contract_violation` event — the swallow-and-publish escape is gone.
 *
 * `issues` carries the per-path contract violations (the first one is also
 * the headline message).
 */
export class OutputContractError extends Error {
  readonly nodeKey: string;
  readonly issues: readonly string[];

  constructor(params: { nodeKey: string; issues: readonly string[] }) {
    const first = params.issues[0];
    super(`${params.nodeKey}: output contract violation — ${first ?? "the output did not satisfy its schema"}`);
    this.name = "OutputContractError";
    this.nodeKey = params.nodeKey;
    this.issues = params.issues;
  }
}
