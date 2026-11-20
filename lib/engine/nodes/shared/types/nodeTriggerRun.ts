/**
 * One run inside an engine-triggered bundle (a single trigger may start
 * several runs — e.g. the sequential multi-branch build). Input is
 * parseInput-validated by the engine; before/after own the surrounding wiring.
 */
export interface NodeTriggerRun {
  input: unknown;
  /** runs before the node run (e.g. branch row → building) */
  before?: () => void;
  /** runs after the node run succeeded (e.g. branch row → awaiting_approval) */
  after?: () => void;
}
