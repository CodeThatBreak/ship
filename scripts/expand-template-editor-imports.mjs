#!/usr/bin/env node
/** Expand @/components/templateEditor barrel imports to concrete modules. */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const BASE = "@/components/templateEditor";

/** @type {Record<string, string>} */
const SYMBOL_TO_MODULE = {
  DeclarativeConfigFields: `${BASE}/DeclarativeConfigFields`,
  DeclarativeConfigFieldsProps: `${BASE}/DeclarativeConfigFields`,
  PromptTab: `${BASE}/PromptTab`,
  PromptSectionField: `${BASE}/PromptSectionField`,
  PromptTemplateSection: `${BASE}/PromptSectionField`,
  ConfigFieldRow: `${BASE}/ConfigFieldRow`,
  SecretsChipGroup: `${BASE}/ConfigFieldRow`,
  VariablesPicker: `${BASE}/ConfigFieldRow`,
  companionTextOf: `${BASE}/ConfigFieldRow`,
  writeConfig: `${BASE}/ConfigFieldRow`,
  NODE_BOILERPLATE: `${BASE}/boilerplate`,
  NODE_KIND_DESCRIPTIONS: `${BASE}/boilerplate`,
  NODE_TEMPLATE_KINDS: `${BASE}/boilerplate`,
  boilerplateFor: `${BASE}/boilerplate`,
  NodeTemplateKind: `${BASE}/boilerplate`,
  kindContractRequest: `${BASE}/utils/contractRequest`,
  nodeContractRequest: `${BASE}/utils/contractRequest`,
  contractConfigSignature: `${BASE}/utils/contractRequest`,
  contractRelevantConfig: `${BASE}/utils/contractRequest`,
  nodeContractQueryOptions: `${BASE}/queries`,
  describeTrigger: `${BASE}/types`,
  nodeLabel: `${BASE}/types`,
  nodeRelationships: `${BASE}/types`,
  isPlanDownstream: `${BASE}/types`,
  NodeContract: `${BASE}/types`,
  EditorNode: `${BASE}/types`,
  EditorEdge: `${BASE}/types`,
  DraftNodeDef: `${BASE}/types`,
  TaskProviderInfo: `${BASE}/types`,
  EditorNodePatch: `${BASE}/types`,
  FLOW_TRIGGER_TYPE: `${BASE}/constants`,
  WebhookPayloadDialog: `${BASE}/WebhookPayloadDialog`,
  NodePalette: `${BASE}/NodePalette`,
  NodePaletteProps: `${BASE}/NodePalette`,
  BuilderCanvas: `${BASE}/BuilderCanvas`,
  BuilderApi: `${BASE}/BuilderCanvas`,
  BuilderCanvasProps: `${BASE}/BuilderCanvas`,
  NodeConfiguratorBody: `${BASE}/NodeConfigurator`,
  IncomingLink: `${BASE}/NodeConfigurator`,
  UpstreamGroup: `${BASE}/NodeConfigurator`,
  EdgeEditor: `${BASE}/EdgeEditor`,
  FlowSettingsBody: `${BASE}/FlowSettings`,
  RepoOption: `${BASE}/FlowSettings`,
  FlowSettingsDraft: `${BASE}/FlowSettings`,
  FlowSettingsHook: `${BASE}/FlowSettings`,
  schemaRows: `${BASE}/variables`,
  Draft: `${BASE}/draft`,
  CanvasPosition: `${BASE}/draft`,
  START_NODE_TEMPLATE_ID: `${BASE}/draft`,
  KIND_LABELS: `${BASE}/draft`,
  KIND_ICONS: `${BASE}/draft`,
  uniqueKey: `${BASE}/draft`,
  nextDraftName: `${BASE}/draft`,
  collectPendingDefs: `${BASE}/draft`,
  dagreLayout: `${BASE}/layout`,
  initialPositions: `${BASE}/layout`,
  useDeferredNodeContractRequest: `${BASE}/hooks/useDeferredNodeContractRequest`,
  useTemplateDraft: `${BASE}/hooks/useTemplateDraft`,
  TemplateDraftMachine: `${BASE}/hooks/useTemplateDraft`,
  useNodePositions: `${BASE}/hooks/useNodePositions`,
  NodePositionsApi: `${BASE}/hooks/useNodePositions`,
  LayoutSync: `${BASE}/hooks/useNodePositions`,
  useTemplateValidation: `${BASE}/hooks/useTemplateValidation`,
  problemsMessage: `${BASE}/hooks/useTemplateValidation`,
  TemplateValidationApi: `${BASE}/hooks/useTemplateValidation`,
};

const parseNamedImports = (clause) => {
  const inner = clause.slice(1, -1);
  return inner.split(",").flatMap((part) => {
    const trimmed = part.trim();
    if (!trimmed) return [];
    const isType = trimmed.startsWith("type ");
    const cleaned = trimmed.replace(/^type\s+/, "").trim();
    const asMatch = cleaned.match(/^(\w+)\s+as\s+(\w+)$/);
    if (asMatch) {
      return [{ imported: asMatch[1], local: asMatch[2], isType }];
    }
    return [{ imported: cleaned, local: cleaned, isType }];
  });
};

const walk = (dir, acc = []) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === ".next") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(ent.name)) acc.push(full);
  }
  return acc;
};

const rewrite = (content) => {
  const re =
    /import\s+(type\s+)?(\{[^}]+\})\s+from\s+['"]@\/components\/templateEditor['"]\s*;?/g;
  return content.replace(re, (full, typeKw, clause) => {
    const specs = parseNamedImports(clause);
    const byModule = new Map();
    for (const spec of specs) {
      const mod = SYMBOL_TO_MODULE[spec.imported];
      if (!mod) {
        console.warn(`Unknown symbol ${spec.imported}`);
        return full;
      }
      if (!byModule.has(mod)) byModule.set(mod, []);
      byModule.get(mod).push({ ...spec, isType: spec.isType || Boolean(typeKw) });
    }
    return [...byModule.entries()]
      .map(([mod, items]) => {
        const allType = items.every((i) => i.isType);
        const inner = items
          .map((i) => {
            const prefix = i.isType ? "type " : "";
            if (i.imported === i.local) return `${prefix}${i.imported}`;
            return `${prefix}${i.imported} as ${i.local}`;
          })
          .join(", ");
        return allType
          ? `import type { ${inner.replace(/type /g, "")} } from "${mod}";`
          : `import { ${inner} } from "${mod}";`;
      })
      .join("\n");
  });
};

for (const abs of walk(ROOT)) {
  const content = fs.readFileSync(abs, "utf8");
  const next = rewrite(content);
  if (next !== content) fs.writeFileSync(abs, next);
}
console.log("templateEditor barrel imports expanded.");
