import "server-only";

/**
 * Thrown when a node's materialized stage-start input violates its `consumes`
 * contract (engine overhaul step 04, Invariant 5 — contracts all the way
 * down). The stage runner refuses to proceed: the node fails with a typed
 * `input_contract_violation` event instead of running on incomplete data.
 *
 * `producerKey` names the upstream node the missing field should have come
 * from when it can be attributed (an `input_map` expression addressing
 * `nodes.<key>.output.*`); null when the input was engine-constructed
 * (built-in `triggerRuns`) and no producer owns the field.
 */
export class InputContractError extends Error {
  readonly nodeKey: string;
  readonly missingField: string;
  readonly producerKey: string | null;

  constructor(params: { nodeKey: string; missingField: string; producerKey?: string | null; detail?: string }) {
    const producer = params.producerKey ? ` — produced by "${params.producerKey}"` : "";
    super(
      `${params.nodeKey}: input contract violation — missing required input field "${params.missingField}"${producer}` +
        (params.detail ? ` (${params.detail})` : ""),
    );
    this.name = "InputContractError";
    this.nodeKey = params.nodeKey;
    this.missingField = params.missingField;
    this.producerKey = params.producerKey ?? null;
  }
}
