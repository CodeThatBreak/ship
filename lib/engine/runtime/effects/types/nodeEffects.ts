import "server-only";

import type { TriggerSource } from "../../triggers/types/triggerGateway";
import type { EffectLifecycle } from "../constants/effectLifecycles";

/**
 * The context one effect dispatch carries: the finished node's identity, the
 * terminal status that fired the lifecycle (null for the approval door), and
 * the trigger params the effect may consume (the
 * approve door's override values ride here). Effects read deeper state through
 * their owning module's host — the context is identity, not a data bus.
 */
export interface EffectCtx {
  flowId: string;
  nodeKey: string;
  defKey: string;
  status: string | null;
  output: Record<string, unknown> | null;
  attemptId?: string | null;
  source: TriggerSource;
  /** Opaque trigger params (e.g. the build approve's `branchName` override). */
  params?: Record<string, unknown>;
}

/**
 * One registered effect: a lifecycle handler owned by its runtime module.
 * An exact-defKey handler claims its follow-on by existing; a wildcard
 * handler claims only by RETURNING `true` (its relevance is decided inside,
 * from config or linkage — see EffectRegistry.run).
 */
export type EffectHandler = (ctx: EffectCtx) => Promise<boolean | void>;

/**
 * The effect surface a node kind or runtime registers (target-architecture
 * §7). Every field is optional — a kind registers only the lifecycles it
 * owns; unregistered lifecycles fall through to the caller's default (the
 * template's edge walk).
 */
export interface NodeEffects {
  afterSuccess?: EffectHandler;
  afterFailure?: EffectHandler;
  afterApproval?: EffectHandler;
  loopReentry?: EffectHandler;
}

export type { EffectLifecycle };
