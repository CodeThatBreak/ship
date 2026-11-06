/**
 * Characterization (red, skipped until step 04): a node missing a required
 * upstream field must fail at stage start with a typed error naming the
 * producing node (engine overhaul step 00; flip in step 04).
 *
 * Skipped (not test.fails) because the `consumes` declaration does not exist
 * on NodeDefinition yet — step 04 adds it (`nodeDefinition.consumes`), the
 * ContractPipeline validates materialized input against it, and the failure
 * is a typed `input_contract_violation` naming the field and the producer.
 * There is no seam to assert against today, so the test is a placeholder
 * documenting the contract.
 *
 * Runs against an isolated temp SQLite DB (AGENTS.md §1 — never a real DB).
 */
import { describe, test } from "vitest";
import { assignDatabasePath, createIsolatedDatabasePath } from "../helpers/testDatabase";

assignDatabasePath(createIsolatedDatabasePath("devflow-ovh-consumes-"));

describe("consumes validation at stage start", () => {
  // OVERHAUL: flip in step 04 (skipped — the consumes declaration doesn't exist yet)
  test.skip("missing required upstream field ⇒ failed with typed error naming the producer", () => {
    // Step 04: a build node declares `consumes: { plan: string }`; a flow whose
    // plan produced no `plan` field fails the build at stage start with a typed
    // `input_contract_violation` event naming `plan` and the producing node.
  });
});
