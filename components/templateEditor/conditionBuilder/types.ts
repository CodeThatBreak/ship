/** Feature-local types for the condition/expression editing surface. */

/** How the builder's rows join (the stored JSONata keeps `and` / `or`). */
export type Combinator = "and" | "or";

/** Which run-time JSONata surface the expression evaluates against. */
export type PreviewScope = "context" | "response" | "delivery";

export interface PreviewState {
  loading: boolean;
  value?: unknown;
  error?: string;
  /** "run" = the template's most recent flow; "sample" = canned sample data */
  source?: "run" | "sample";
}
