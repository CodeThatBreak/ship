/**
 * Client-safe re-exports of the Start node's contract module
 * (`lib/engine/nodes/kinds/start/contract.ts` — pure data + zod, no engine or
 * store imports). The contract's types and the config→fields parse are used
 * by client surfaces (the flow's start panel, the template editor's
 * trigger/contract editors); they come from here so nothing imports
 * `lib/engine` from the client trees (AGENTS.md §2.1, baseline conflict
 * notes in docs/phase0-baseline.md).
 *
 * Source of truth stays in the engine module — the server runtime, the
 * contracts API and the linter parse the exact same schema.
 */
export type {
  StartFieldType,
  StartContractField,
} from "@/lib/engine/nodes/kinds/start/contract";
export { parseStartContract } from "@/lib/engine/nodes/kinds/start/contract";
