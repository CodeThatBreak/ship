#!/usr/bin/env node
/**
 * Replace deleted feature barrel imports with concrete module paths.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

/** @type {Record<string, Record<string, string>>} */
const MAPS = {
  "@/components/shared": {
    LocalApiProvider: "@/components/shared/LocalApiProvider",
    ListSection: "@/components/shared/ListSection",
    ConfirmDeleteDialog: "@/components/shared/ConfirmDeleteDialog",
    DataTable: "@/components/shared/dataTable/DataTable",
    DataTableAction: "@/components/shared/dataTable/DataTable",
    FilterPicker: "@/components/shared/FilterPicker",
    FilterDef: "@/components/shared/FilterPicker",
    Markdown: "@/components/shared/Markdown",
    loadHighlighter: "@/components/shared/highlighter",
    highlightCode: "@/components/shared/highlighter",
    FormModal: "@/components/shared/FormModal",
    FormModalWidth: "@/components/shared/FormModal",
    SheetFooterHelper: "@/components/shared/SheetFooterHelper",
    TabStrip: "@/components/shared/TabStrip",
    RouteError: "@/components/shared/RouteError",
    RouteErrorProps: "@/components/shared/RouteError",
    RouteErrorShell: "@/components/shared/RouteError",
    TableSkeleton: "@/components/shared/TableSkeleton",
    EmptyHint: "@/components/shared/EmptyHint",
    InlineError: "@/components/shared/InlineError",
    Modal: "@/components/shared/Modal",
  },
  "@/components/flows": {
    FlowsView: "@/components/flows/FlowsView",
    FlowCockpit: "@/components/flows/cockpit/FlowCockpit",
    StatusBar: "@/components/flows/StatusBar",
    ICONS: "@/components/flows/workflowGraph/WorkflowGraph",
    useAgentStatus: "@/components/flows/hooks/useAgentStatus",
    AgentStatus: "@/components/flows/hooks/useAgentStatus",
    StatusPayload: "@/components/flows/hooks/useAgentStatus",
    useFlowComments: "@/components/flows/hooks/useFlowComments",
    MrComment: "@/components/flows/hooks/useFlowComments",
    useGraphDef: "@/components/flows/hooks/useGraphDef",
    GraphDef: "@/components/flows/hooks/useGraphDef",
    useArtifact: "@/components/flows/hooks/useArtifact",
    artifactQueryOptions: "@/components/flows/queries",
    ArtifactDetail: "@/components/flows/queries",
  },
  "@/components/tasks": {
    TasksView: "@/components/tasks/TasksView",
  },
  "@/components/templates": {
    TemplateGallery: "@/components/templates/TemplateGallery",
    TemplateNodesCatalog: "@/components/templates/TemplateNodesCatalog",
  },
  "@/components/builder": {
    TemplateEditor: "@/components/builder/EditorPage",
    TemplateEditorProps: "@/components/builder/EditorPage",
    EditorLoading: "@/components/builder/EditorLoading",
    repoChoicesQueryOptions: "@/components/builder/queries",
    fetchRepoChoices: "@/components/builder/queries",
  },
  "@/components/layout": {
    AppSidebar: "@/components/layout/AppSidebar",
  },
  "@/components/settings": {
    settingsQueryOptions: "@/components/settings/queries",
    reposQueryOptions: "@/components/settings/queries",
    gitHostsQueryOptions: "@/components/settings/queries",
    fetchSettings: "@/components/settings/queries",
    fetchRepos: "@/components/settings/queries",
    useSettingsQuery: "@/components/settings/hooks/useSettingsQuery",
    useReposQuery: "@/components/settings/hooks/useReposQuery",
    useSettingsPageError: "@/components/settings/hooks/useSettingsPageError",
    GeneralSettingsSkeleton: "@/components/settings/components/GeneralSettingsSkeleton",
    GeneralSettingsPage: "@/components/settings/general/GeneralSettingsPage",
    RepositoriesSettingsPage: "@/components/settings/repos/RepositoriesSettingsPage",
    IntegrationsSettingsPage: "@/components/settings/integrations/IntegrationsSettingsPage",
    Repo: "@/components/settings/context",
    Harness: "@/components/settings/context",
    HarnessMode: "@/components/settings/context",
    Settings: "@/components/settings/context",
  },
  "@/components/chat": {
    ChatPanel: "@/components/chat/ChatPanel",
    ChatPanelSkeleton: "@/components/chat/ChatPanelSkeleton",
    ModelSelector: "@/components/chat/ModelSelector",
    useModels: "@/components/chat/hooks/useModels",
    PromptModal: "@/components/chat/promptModal/PromptModal",
    ComposerConfig: "@/components/chat/composerConfig",
    ChatTab: "@/components/chat/types",
    ChatInputHandle: "@/components/chat/types",
    ChatAction: "@/components/chat/types/action",
    ACTION_TYPES: "@/components/chat/constants/action",
    SendMutationFn: "@/components/chat/hooks/useChatComposer",
    PlanOptions: "@/components/chat/types",
    FeedEvent: "@/components/chat/timeline",
  },
};

const parseSpecs = (clause) => {
  const inner = clause.slice(1, -1);
  return inner.split(",").flatMap((part) => {
    const t = part.trim();
    if (!t) return [];
    const isType = t.startsWith("type ");
    const c = t.replace(/^type\s+/, "").trim();
    const as = c.match(/^(\w+)\s+as\s+(\w+)$/);
    if (as) return [{ imported: as[1], local: as[2], isType }];
    return [{ imported: c, local: c, isType }];
  });
};

const rewriteImport = (full, typeOnly, clause, barrel) => {
  const map = MAPS[barrel];
  if (!map) return full;
  const specs = parseSpecs(clause);
  const byMod = new Map();
  for (const s of specs) {
    const mod = map[s.imported];
    if (!mod) return full;
    if (!byMod.has(mod)) byMod.set(mod, []);
    byMod.get(mod).push(s);
  }
  return [...byMod.entries()]
    .map(([mod, items]) => {
      const allType = typeOnly || items.every((i) => i.isType);
      const inner = items
        .map((i) => (i.isType ? `type ${i.imported}` : i.imported))
        .join(", ");
      const isDefault =
        mod.endsWith("/FlowCockpit") ||
        mod.endsWith("/ChatPanel") ||
        mod.endsWith("/ChatPanelSkeleton") ||
        mod.endsWith("/PromptModal") ||
        mod.endsWith("/EditorPage");
      if (isDefault && items.length === 1 && !items[0].isType) {
        return `import ${items[0].imported} from "${mod}";`;
      }
      return allType
        ? `import type { ${inner.replace(/type /g, "")} } from "${mod}";`
        : `import { ${inner} } from "${mod}";`;
    })
    .join("\n");
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

for (const abs of walk(ROOT)) {
  let content = fs.readFileSync(abs, "utf8");
  let next = content;
  for (const barrel of Object.keys(MAPS)) {
    const re = new RegExp(
      `import\\s+(type\\s+)?(\\{[^}]+\\})\\s+from\\s+['"]${barrel.replace("/", "\\/")}['"]\\s*;?`,
      "g",
    );
    next = next.replace(re, (full, typeKw, clause) =>
      rewriteImport(full, Boolean(typeKw), clause, barrel),
    );
  }
  if (next !== content) fs.writeFileSync(abs, next);
}
console.log("Feature barrel imports expanded.");
