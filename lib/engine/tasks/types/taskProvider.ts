import "server-only";


/**
 * A task fetched live from the provider's source — never stored as-is. The
 * tasks table shows these at runtime (filter → refetch); a row is only
 * materialized in the DB (`upsertLive`) when a build actually starts, since
 * the flow engine needs the row for FK + context hydration.
 */
export interface LiveTask {
  /** provider kind discriminator (tasks.type when materialized) */
  type: string;
  id: string;
  key: string;
  summary: string;
  description: string;
  status: string;
  issueType: string;
  priority: string;
  externalUrl: string;
  /** parent issue key (sub-task nesting) */
  parentKey: string;
  /** provider-specific payload — jira keeps `prd` and `figma_urls` here */
  fields: Record<string, unknown>;
  /** raw provider payload, kept for faithful re-materialization */
  raw: unknown;
}

/**
 * Structured task filters for the tasks table's predefined filter bar.
 * Omitted/empty values are ignored; a provider composes these into its own
 * query language (jira → JQL). With no filters set, the provider falls back
 * to its configured default query.
 */
export interface LiveTaskFilters {
  /** "me" (default) = current user; "any" = everyone */
  assignee?: "me" | "any";
  /** workflow-agnostic status bucket: "To Do" | "In Progress" | "Done" */
  statusCategory?: string;
  /** free-text search across the task */
  text?: string;
}

/** Normalized filter tuple used as the live-fetch cache key. */
export type ResolvedLiveTaskFilters = {
  assignee: NonNullable<LiveTaskFilters["assignee"]>;
  statusCategory: string;
  text: string;
};

/**
 * One field a task type contributes to the `{{task.*}}` variable universe.
 *
 * Mirrors the start-contract field style (`nodes/kinds/start/contract.ts`): `key` is
 * the template-facing name, `type` is the JSON type the value evaluates to.
 * The list a provider declares becomes the lint vocabulary for `{{task.*}}`
 * refs (Phase 3 context-lint).
 */
export interface TaskField {
  /** exposed as {{task.<key>}} */
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  /** providers that always produce this field mark it required */
  required?: boolean;
}

/** Masked view of one provider instance — no secrets (settings UI shape). */
export interface ProviderInstance {
  id: string;
  name: string | null;
  baseUrl: string;
  /** non-secret login identity (jira: the account email), empty when n/a */
  email?: string;
  /** masked token ("••••abcd") — never the real value */
  tokenMasked: string;
}

/**
 * Instance registry of one task provider — the CRUD + test surface the
 * /api/task-instances routes expose (mirrors GitHostService's instance half).
 */
export interface TaskInstanceStore {
  instances(): Promise<ProviderInstance[]>;
  addInstance(input: { name?: string | null; baseUrl: string; email?: string; token: string }): Promise<ProviderInstance>;
  /** Update by id; a blank/absent token keeps the stored one. */
  updateInstance(id: string, input: { name?: string | null; baseUrl?: string; email?: string; token?: string }): Promise<void>;
  removeInstance(id: string): Promise<void>;
  /** Quick reachability/auth check (settings UI "Test" button). */
  testInstance(id: string, input?: { baseUrl?: string; email?: string; token?: string }): Promise<{ ok: boolean; detail: string }>;
}
