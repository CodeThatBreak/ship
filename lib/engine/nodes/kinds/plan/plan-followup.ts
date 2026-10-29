import { extractJson } from "../agent/json-schema-lite";
import { AgentOutputError } from "../../shared/agent/output-error";
import { PLAN_UPDATED_REPLY } from "./constants/refine";

/**
 * The plan conversation's follow-up parse (docs/plan-conversation-refine.md §1)
 * — a pure, class-free pipeline. It decides the TURN KIND only and never the
 * plan payload's validity: the plan object rides through UNVALIDATED so that
 * `PlanNode.applyPlanVersion` (the same validation chain a normal refine use)
 * is what surfaces refinement violations — into the §3c bounded retry and a
 * plain-language refusal — instead of degrading them silently to reply-only.
 *
 * (Deliberate strictness decision, §1: the exported `PlanFollowUp` schema
 * couples its envelope shape to `PlanResponse`'s refinements, so
 * `PlanFollowUp.safeParse` at parse time would fold "invalid plan content"
 * into "no plan" — strictly-wrong kind. Here the envelope check is shape-only
 * and the plan payload's schema-checking happens exactly once, at the apply.)
 *
 * Decision table (one extracted JSON object, non-array):
 *  1. has a non-empty string `reply`, or a present non-null `plan` → follow-up
 *     turn; reply defaults to `Plan updated.` when the model elided it (§8:
 *     plan wins). An omitted or explicit `null` `plan` is the same reply-only turn.
 *  2. no envelope, but the object carries plan-domain fields
 *     (`markdown`/`steps`/`branches`) → plan-only attempt: the model dropped
 *     the envelope. Even a refinement-invalid attempt lands here, so the
 *     apply's validation catches the violation (bounded retry, never silent).
 *  3. the agent's standard error envelope ({@link AgentOutputError.reported})
 *     → reply-only, and the agent's own reason becomes the reply.
 *  4. ANYTHING else → reply-only with the raw text as the reply + a debug log.
 *     Free-form output is NEVER a plan — wrong guesses cost a turn, not a version.
 */

/** One parsed conversation turn: the reply text — and the plan payload the
 *  turn carries (any state, possibly refinement-invalid), or null reply-only. */
export interface ParsedFollowUp {
  reply: string;
  plan: unknown;
}

/** The follow-up envelope check: SHAPE only (a contract-shaped turn exists
 *  whenever the model sent a reply or a plan); the plan payload is untouched. */
function followUpOf(obj: Record<string, unknown>): ParsedFollowUp | null {
  const reply = typeof obj.reply === "string" && obj.reply.trim() !== "" ? obj.reply : null;
  // an explicit "plan": null is the same as an omitted "plan" (reply only, §1)
  const plan = obj.plan != null ? obj.plan : null;
  if (plan != null) return { reply: reply ?? PLAN_UPDATED_REPLY, plan };
  if (reply != null) return { reply, plan: null };
  return null;
}

/** A bare object that clearly tried to be a plan (envelope dropped) — even a
 *  refinement-invalid one routes to the apply path (see the module doc). */
function looksLikeAPlan(obj: Record<string, unknown>): boolean {
  return (
    (typeof obj.markdown === "string" && obj.markdown.trim() !== "") ||
    "steps" in obj ||
    "branches" in obj
  );
}

export function parseFollowUp(raw: unknown): ParsedFollowUp {
  const text = typeof raw === "string" ? raw.trim() : "";
  // the same light pre-processing the plan contract parser uses (fence/brace
  // extraction) — the contract turn lives in a JSON object
  const obj = extractJson(text);
  if (obj != null && typeof obj === "object" && !Array.isArray(obj)) {
    const record = obj as Record<string, unknown>;
    const followUp = followUpOf(record);
    if (followUp) return followUp;
    if (looksLikeAPlan(record)) {
      console.debug("[plan] follow-up response came as a bare plan (envelope dropped) — reply defaults");
      return { reply: PLAN_UPDATED_REPLY, plan: record };
    }
    // the agent's escape hatch: it answered with the standard error envelope
    // instead of contract-conforming output — convey its reason
    const reported = AgentOutputError.reported(record);
    if (reported != null) return { reply: reported.reason, plan: null };
  }
  console.debug("[plan] follow-up response carried no contract turn — the raw text becomes the reply");
  return { reply: text, plan: null };
}
