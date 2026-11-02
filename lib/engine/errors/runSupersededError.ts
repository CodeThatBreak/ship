import "server-only";

/** Thrown when an in-flight agent run completes after the node left `running`. */
export class RunSupersededError extends Error {
  constructor(
    readonly nodeId: string,
    readonly nodeStatus: string,
    readonly runId: string,
  ) {
    super(
      `Agent run ${runId} for node ${nodeId} was superseded (node is ${nodeStatus})`,
    );
    this.name = "RunSupersededError";
  }
}
