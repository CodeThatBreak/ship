export interface CreateFlowOptions {
  executionMode?: "cloud" | "local";
  repoId?: string;
  templateId?: string;
  triggerPayload?: unknown;
  autoStart?: boolean;
}
