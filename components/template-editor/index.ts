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
export type { NodeContract } from "./types";
export { FLOW_TRIGGER_TYPE } from "./constants";
export { WebhookPayloadDialog } from "./WebhookPayloadDialog";
