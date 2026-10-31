/** Public surface of the flow feature — other routes go through this barrel. */
export { FlowsView } from "./FlowsView";
export { default as FlowCockpit } from "./cockpit/FlowCockpit";
/** The workspace status bar (rendered by the app shell; it reads flow status). */
export { StatusBar } from "./StatusBar";
/** Icon resolution lives with the graph (the template builder reuses it). */
export { ICONS } from "./workflow-graph/WorkflowGraph";
export type { FlowSummary, WorktreeStatus } from "@/types/flows";
export { artifactQueryOptions, type ArtifactDetail } from "./queries";
export { useAgentStatus } from "./hooks/useAgentStatus";
export type { AgentStatus, StatusPayload } from "./hooks/useAgentStatus";
export { useFlowComments } from "./hooks/useFlowComments";
export type { MrComment } from "./hooks/useFlowComments";
export { useGraphDef } from "./hooks/useGraphDef";
export type { GraphDef } from "./hooks/useGraphDef";
export { useArtifact } from "./hooks/useArtifact";
