import "server-only";

import {
  validateSimplePlan,
  validateComplexPlan,
  validateSubPlan,
  type PlanValidationError,
  type SimplePlanResponse,
  type ComplexPlanResponse,
  type SubPlanResponse,
} from "./schema";

/** Result of parsing a plan response. */
export interface PlanParseResult<T> {
  /** The parsed and validated data, or null when invalid. */
  data: T | null;
  /** Validation errors (empty when valid). */
  errors: PlanValidationError[];
}

/**
 * Parses and validates JSON-only plan responses (simple and complex).
 */
export class PlanMetaParser {
  /**
   * Parse a JSON-only plan response (simple or complex).
   * Handles optional code fences around the JSON.
   */
  parseJson<T>(
    text: string,
    validate: (raw: unknown) => { plan: T; errors: [] } | { plan: null; errors: PlanValidationError[] },
  ): PlanParseResult<T> {
    const jsonText = extractJson(text);
    if (!jsonText) return { data: null, errors: [{ path: "", message: "no JSON object found in response" }] };
    try {
      const raw = JSON.parse(jsonText);
      const result = validate(raw);
      return { data: result.plan ?? null, errors: result.errors as PlanValidationError[] };
    } catch (e) {
      return { data: null, errors: [{ path: "", message: `invalid JSON: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  }

  /** Parse a simple plan response (JSON with markdown + steps). */
  parseSimple(text: string): PlanParseResult<SimplePlanResponse> {
    return this.parseJson(text, validateSimplePlan);
  }

  /** Parse a complex plan response (JSON with markdown + steps + branches). */
  parseComplex(text: string): PlanParseResult<ComplexPlanResponse> {
    return this.parseJson(text, validateComplexPlan);
  }

  /** Parse a branch-scoped sub-plan response (this branch's markdown + steps only). */
  parseSubPlan(text: string): PlanParseResult<SubPlanResponse> {
    return this.parseJson(text, validateSubPlan);
  }
}

/** Extract a JSON object from text, handling optional code fences. */
function extractJson(text: string): string | null {
  const trimmed = text.trim();
  // Strip markdown code fences if the entire response is wrapped
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
  // Find the JSON object boundaries
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  return candidate.slice(firstBrace, lastBrace + 1);
}
