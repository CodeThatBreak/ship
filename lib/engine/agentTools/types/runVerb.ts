import "server-only";

import type { EffectVerb } from "../../runtime/effects/constants/effectVerbs";
import type { VerbCtx } from "../../runtime/effects/verbs/types/verbDescriptor";

/**
 * The verb-run seam the tool dispatches through (the `VerbRegistry.run`
 * shape) — constructor-injected so the tool never statically imports the
 * verb wiring (whose module init dereferences the engine pins).
 */
export type RunVerb = (verb: EffectVerb, ctx: VerbCtx) => Promise<boolean>;
