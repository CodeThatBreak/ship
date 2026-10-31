/**
 * Model-catalog parameter constants shared by the model picker (client) and
 * the model-spec / run services (server). Plain strings — safe to import from
 * both sides.
 */

/** The Cursor fast-mode parameter on composer-family models. */
export const FAST_PARAM = "fast";

/**
 * Fast mode is boolean in the catalog. DevFlow defaults it OFF and an
 * unstated/fast-less selection falls through to the account's default variant,
 * which is fast=true for composer models — so the run path pins `fast=false`
 * explicitly (see normalizeModelSpec for storage semantics and
 * CursorAgentService.pinFastOff for the wire).
 */
export const FAST_ON = "true";
export const FAST_OFF = "false";

/**
 * Concrete model id used when local SDK runs have no per-run / settings /
 * env pick (local agents reject "auto" and omitted model on create/resume/send).
 */
export const LOCAL_DEFAULT_MODEL = "composer-2.5";
