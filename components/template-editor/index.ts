/**
 * The template editor's public surface (§1.7 barrel): what other features
 * (the Template Nodes page, hosts embedding configurator pieces) consume.
 * Deep paths across features are forbidden — import from here.
 */
export { DeclarativeConfigFields, type DeclarativeConfigFieldsProps } from "./DeclarativeConfigFields";
export { PromptTab } from "./PromptTab";
export { PromptSectionField, type PromptTemplateSection } from "./PromptSectionField";
export {
  ConfigFieldRow,
  SecretsChipGroup,
  VariablesPicker,
  companionTextOf,
  writeConfig,
} from "./ConfigFieldRow";
export {
  NODE_BOILERPLATE,
  NODE_KIND_DESCRIPTIONS,
  NODE_TEMPLATE_KINDS,
  boilerplateFor,
  type NodeTemplateKind,
} from "./boilerplate";
export { kindContractUrl } from "./types";
export { nodeContractQueryOptions } from "./queries";
export { contractsUrl, describeTrigger, nodeLabel, nodeRelationships, isPlanDownstream } from "./types";
export type { NodeContract, EditorNode, EditorEdge, DraftNodeDef, TaskProviderInfo } from "./types";
export { FLOW_TRIGGER_TYPE } from "./constants";
export { WebhookPayloadDialog } from "./WebhookPayloadDialog";

// ── builder surfaces consumed across features (the editor route's page-local
//    wrappers import these; other features may too) ─────────────────────────
export { default as NodePalette, type NodePaletteProps } from "./NodePalette";
export { default as BuilderCanvas, type BuilderApi, type BuilderCanvasProps } from "./BuilderCanvas";
export { NodeConfiguratorBody, type IncomingLink, type UpstreamGroup } from "./NodeConfigurator";
export { EdgeEditor } from "./EdgeEditor";
export { FlowSettingsBody, type RepoOption, type FlowSettingsDraft, type FlowSettingsHook } from "./FlowSettings";
export { schemaRows } from "./variables";
// draft model + auto-layout (pages seed them with server-fetched payloads)
export {
  type Draft,
  type CanvasPosition,
  START_NODE_TEMPLATE_ID,
  KIND_LABELS,
  KIND_ICONS,
  uniqueKey,
  nextDraftName,
  collectPendingDefs,
} from "./draft";
export { dagreLayout, initialPositions } from "./layout";
export { useTemplateDraft, type TemplateDraftMachine } from "./hooks/use-template-draft";
export { useNodePositions, type NodePositionsApi, type LayoutSync } from "./hooks/use-node-positions";
export {
  useTemplateValidation,
  problemsMessage,
  type TemplateValidationApi,
} from "./hooks/use-template-validation";
