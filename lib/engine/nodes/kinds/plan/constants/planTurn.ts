import 'server-only';

export enum PlanTurnKind {
  // Whole master plan is being refined in this turn.
  Whole = 'whole',
  // The plan is being finalized for publishing (pre-publish).
  PrePublish = 'pre-publish',
}
