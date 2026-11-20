import "server-only";

import { NodeRoleRouter } from "./nodeRoles/nodeRoleRouter";

/**
 * The role router (§T4): the ONE place dispatching a def's chat / converse /
 * prompt-preview affordances, keyed off the `capabilities` metadata the
 * server already serializes to the UI, plus the preview-config helpers the
 * former base-class methods backed. Stateless over injected defs — one
 * engine-wide instance (`nodeRoles`), pass a def per call.
 *
 * The NodeRoleRouter class lives in `nodeRoles/nodeRoleRouter.ts`, the role
 * contracts in `nodeRoles/types/` and the prompt-source vocabulary in
 * `constants/promptSource.ts` — class files are pure (classFilePurity arch
 * test); this module keeps the pin so the import surface is unchanged.
 */
export const nodeRoles = new NodeRoleRouter();
