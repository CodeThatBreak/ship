/** The `failed_output` artifact's meta narrowed to what the renderer shows
 *  (Task 20). Restated client-side — the client cannot import `lib/engine`
 *  (the usagePayload precedent). Null when the meta carries no violation
 *  ledger at all (the renderer's raw-body fallback). */
export interface FailedOutputViolationView {
  path: string;
  message: string;
}

export interface FailedOutputPayloadView {
  /** the retryable output-contract code that exhausted the budget */
  code: string;
  /** feedback retries the run spent before the failure went terminal */
  budget: number;
  /** the schema violations (dotted path + message) of the last response */
  issues: FailedOutputViolationView[];
}

export const parseFailedOutputPayload = (meta: unknown): FailedOutputPayloadView | null => {
  if (meta == null || typeof meta !== "object" || Array.isArray(meta)) return null;
  const o = meta as Record<string, unknown>;
  const code = typeof o.code === "string" && o.code ? o.code : null;
  const issues = (Array.isArray(o.issues) ? o.issues : [])
    .filter((issue): issue is Record<string, unknown> => issue != null && typeof issue === "object" && !Array.isArray(issue))
    .map((issue) => ({
      path: typeof issue.path === "string" ? issue.path : "",
      message: typeof issue.message === "string" ? issue.message : "",
    }))
    .filter((issue) => issue.message);
  // no code and no violations → not a failed-output ledger → the raw fallback
  if (code == null && issues.length === 0) return null;
  return {
    code: code ?? "schema_mismatch",
    budget: typeof o.budget === "number" && Number.isFinite(o.budget) ? o.budget : 0,
    issues,
  };
};
