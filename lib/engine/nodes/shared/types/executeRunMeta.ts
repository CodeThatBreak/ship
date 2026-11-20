import "server-only";

/** Metadata from `AgentRunner.executeRun` passed into finalize hooks. */
export interface ExecuteRunMeta {
  runRowId: string;
}
