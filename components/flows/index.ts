/** Public surface of the flow feature — other routes go through this barrel. */
export { FlowsView } from "./FlowsView";
export { default as FlowCockpit } from "./cockpit/FlowCockpit";
/** The workspace status bar (rendered by the app shell; it reads flow status). */
export { StatusBar } from "./StatusBar";
/** Icon resolution lives with the graph (the template builder reuses it). */
export { ICONS } from "./workflow-graph/WorkflowGraph";
export type { FlowSummary, WorktreeStatus } from "@/types/flows";
