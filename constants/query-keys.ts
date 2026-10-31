/**
 * Single source of truth for TanStack Query keys — every useQuery fetch and
 * mutation invalidation pulls from here so invalidation can never drift away
 * from its fetching key (AGENTS.md §1.6).
 */
export const queryKeys = {
  settings: ["settings"] as const,
  repos: ["repos"] as const,
  /** editor Bound-repo picker slice (id/name/local_path only — not full Repo[]) */
  repoChoices: ["repos", "editor-choices"] as const,
  templates: {
    /** one template's detail row (nodes/edges included) */
    detail: (id: string) => ["templates", "detail", id] as const,
    /** one template's webhook context — start-contract fields + hook
     *  (the payload dialog's body/curl) */
    webhook: (id: string) => ["templates", "webhook", id] as const,
    /** one expression's live preview value, evaluated against the template's
     *  context (the debounced expression is part of the identity) */
    preview: (id: string, scope: string, expr: string) =>
      ["templates", "preview", id, scope, expr] as const,
  },
  /** detected worktree policy for one local checkout (form prefill) */
  reposDetect: (localPath: string) => ["repos", "detect", localPath] as const,
  /** registered task providers (GET /api/tasks/providers — the editor's
   *  Task-context picker + {{task.*}} chip vocabulary) */
  taskProviders: ["tasks", "providers"] as const,
  gitHosts: ["git-hosts"] as const,
  integrations: {
    /** instance list of one provider kind (host = git hosts, task = task providers) */
    instances: (surface: string, kind: string) =>
      ["integrations", "instances", surface, kind] as const,
    /** localStorage-persisted connection-test outcomes, keyed `provider:id` */
    testResults: ["integrations", "test-results"] as const,
  },
  /** the shared node-template catalog page list (GET /api/node-templates,
   *  unscoped: built-ins + the global Library rows) */
  nodeTemplates: ["node-templates", "catalog"] as const,
  // ── Phase 1+2 template-editor/editor domain ──────────────────────────────
  /** the palette's catalog fetch (built-in rows + the template's local rows)
   *  — one GET /api/node-templates back both sections */
  templatesCatalog: (templateId: string) =>
    ["templates", "catalog", templateId] as const,
  /** the gallery list (GET /api/templates — the fan-out child picker) */
  templatesGallery: ["templates", "gallery"] as const,
  /** one node instance's resolved contract — the request URL is the identity
   *  (def/kind + the instance config, per /api/contracts) */
  nodeContracts: (url: string) => ["node-contracts", url] as const,
  tasks: {
    /** the runtime live-feed behind the tasks table — the serialized query
     *  string (filters + text) is the identity, so every filter change is a
     *  new query key and refetches keep serving through the route's cache */
    live: (params: string) => ["tasks", "live", params] as const,
  },
  flows: {
    /** one flow's live snapshot (the cockpit's polled flow read) */
    detail: (flowId: string) => ["flows", "detail", flowId] as const,
    /** the flow's live event stream batches (`after`-cursor polling) */
    events: (flowId: string) => ["flows", "events", flowId] as const,
    /** one node's assembled prompt — `params` is the serialized request
     *  query; the selection-scoped preview read is prefixed `preview:` */
    prompt: (flowId: string, params: string) =>
      ["flows", "prompt", flowId, params] as const,
    /** invalidation prefix for every prompt read of one flow */
    promptScope: (flowId: string) => ["flows", "prompt", flowId] as const,
    /** chat transcript of one flow (chat panel, polled) */
    chat: (flowId: string) => ["flows", "chat", flowId] as const,
    /** a node's prompt preview, before its first output (prompt-publishing nodes) */
    nodePrompt: (flowId: string, nodeKey: string) =>
      ["flows", "node-prompt", flowId, nodeKey] as const,
    /** every promptable node's prompt body in one read (the plan composer's prefill) */
    prompts: (flowId: string) => ["flows", "prompts", flowId] as const,
    /** a node's branch-scoped prompt body (the plan composer's scoped prefill, §4c) */
    nodeBranchPrompt: (flowId: string, nodeKey: string, branch: string) =>
      ["flows", "node-branch-prompt", flowId, nodeKey, branch] as const,
    /** MR comments of one flow's review (polled while the MR is open) */
    comments: (flowId: string) => ["flows", "comments", flowId] as const,
    /** the workspace flow list (initial data rendered server-side) */
    list: ["flows", "list"] as const,
    /** per-flow worktree git state (polled while local flows exist) */
    worktreeStatus: ["flows", "worktree-status"] as const,
  },

  // ── flow/chat cluster (Phase 2) ──────────────────────────────────────────
  /** workspace agent-activity snapshot (status bar, polled every 5s) */
  status: ["status"] as const,
  /** flow model catalog (/api/models, fetched once per session) */
  modelCatalog: ["models", "catalog"] as const,
  /** graph definition — the flow's template snapshot (or the built-in registry graph) */
  graph: (flowId: string) => ["graph", flowId] as const,
  /** one artifact row (panels read it through the query cache) */
  artifacts: {
    detail: (id: string) => ["artifacts", "detail", id] as const,
  },
} as const;
