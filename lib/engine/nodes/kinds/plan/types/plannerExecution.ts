import "server-only";

/** The planner's execution decision out of a parsed plan response. */
export interface PlannerExecution {
  value: 'whole' | 'steps';
  rationale: string | null;
}
