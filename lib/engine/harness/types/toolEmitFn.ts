/** Emit callback for paired tool-call events (name, status, ids, payload). */
export type ToolEmitFn = (
  name: string,
  status: string,
  callId: string,
  args?: unknown,
  result?: string,
  startedAt?: number
) => void;
