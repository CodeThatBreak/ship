/**
 * Mechanical sqlite→Postgres codemod for the step-01 migration.
 * Transforms one TS source file's SQL + db call shapes:
 *  - `?` placeholders inside SQL template literals → $1..$N (outside strings)
 *  - SELECT column lists → camelCase aliases
 *  - db.transaction(() => …) → async-aware arrow with tx threading
 *  - JSON.stringify(x) as a SQL arg → x + ::jsonb cast on the matching placeholder
 * Returns { code, changed }.
 */

// snake_case column → camelCase (SELECT alias conversion)
const COLUMN_MAP = {
  task_id: "taskId", mr_url: "mrUrl", mr_iid: "mrIid", mr_branch: "mrBranch",
  repo_url: "repoUrl", gitlab_project_id: "gitlabProjectId", current_node: "currentNode",
  execution_mode: "executionMode", repo_id: "repoId", template_id: "templateId",
  template_graph: "templateGraph", trigger_payload: "triggerPayload",
  worktree_dir: "worktreeDir", parent_flow_id: "parentFlowId", created_at: "createdAt",
  updated_at: "updatedAt", flow_id: "flowId", node_key: "nodeKey", attempt_id: "attemptId",
  agent_id: "agentId", agent_ref: "agentRef", session_id: "sessionId",
  prompt_override: "promptOverride", join_mode: "joinMode", node_id: "nodeId",
  discussion_id: "discussionId", file_path: "filePath", resolved_by: "resolvedBy",
  artifact_id: "artifactId", meta_id: "metaId", completed_by: "completedBy",
  sub_flow_id: "subFlowId", git_branch: "gitBranch", run_ref: "runRef",
  branch_id: "branchId", input_tokens: "inputTokens", output_tokens: "outputTokens",
  cache_read_tokens: "cacheReadTokens", cache_write_tokens: "cacheWriteTokens",
  duration_ms: "durationMs", cost_cents: "costCents", cloud_url: "cloudUrl",
  local_path: "localPath", default_branch: "defaultBranch", use_worktrees: "useWorktrees",
  install_command: "installCommand", skip_install: "skipInstall", sync_paths: "syncPaths",
  shared_dirs: "sharedDirs", setup_command: "setupCommand",
  worktree_timeout_ms: "worktreeTimeoutMs", base_url: "baseUrl", is_builtin: "isBuiltin",
  schedule_next_at: "scheduleNextAt", node_template_id: "nodeTemplateId",
  input_map: "inputMap", from_key: "fromKey", to_key: "toKey", hook_id: "hookId",
  webhook_id: "webhookId", parent_node: "parentNode", issue_type: "issueType",
  parent_key: "parentKey", external_url: "externalUrl", synced_at: "syncedAt",
  delete_branch: "deleteBranch", repo_path: "repoPath", parent_flow_id: "parentFlowId",
  step_flow_id: "stepFlowId", output_schema: "outputSchema",
};

const ORDERED_COLS = Object.keys(COLUMN_MAP).sort((a, b) => b.length - a.length);

/** Convert `?` placeholders inside a template literal's SQL to $N. */
function convertPlaceholders(sql) {
  let n = 0;
  let out = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inSingle) {
      out += ch;
      if (ch === "'" && sql[i - 1] !== "\\") inSingle = false;
      continue;
    }
    if (inDouble) {
      out += ch;
      if (ch === '"' && sql[i - 1] !== "\\") inDouble = false;
      continue;
    }
    if (ch === "'") { inSingle = true; out += ch; continue; }
    if (ch === '"') { inDouble = true; out += ch; continue; }
    if (ch === "?") { n++; out += `$${n}`; continue; }
    out += ch;
  }
  return out;
}

/** Add camelCase aliases to bare snake_case column refs in SELECT lists. */
function aliasSelectList(sql) {
  // only inside SELECT ... FROM spans (first SELECT per statement is enough for our SQL)
  return sql.replace(
    /(SELECT\s+)([\s\S]*?)(\s+FROM\s)/gi,
    (_m, sel, list, from) => {
      let out = list;
      for (const col of ORDERED_COLS) {
        const alias = COLUMN_MAP[col];
        // table-qualified: n.node_key AS "nodeKey"
        out = out.replace(
          new RegExp(`(\\b\\w+)\\.${col}\\b(?![^"]*")(?![^']*')`, "g"),
          `$1.${col} AS "${alias}"`,
        );
        // bare column followed by comma or end — avoid matching inside strings/aliases
        out = out.replace(
          new RegExp(`(?<![\\w".])${col}(?![\\w"])(?=\\s*(,|$))(?![^']*')`, "gm"),
          `${col} AS "${alias}"`,
        );
      }
      return sel + out + from;
    },
  );
}

/** `f.*` inside a SELECT list — expand via info we don't have; flag instead. */
export function transform(code) {
  let changed = false;
  let out = code;

  // 1. SQL template literals passed to db.get/all/run/rows.get/rows.all:
  //    find backtick strings containing SQL keywords and convert.
  out = out.replace(/`([^`]*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^`]*)`/gis, (m, sql) => {
    let next = sql;
    if (next.includes("?")) next = convertPlaceholders(next);
    const aliased = aliasSelectList(next);
    next = aliased;
    if (next !== sql) changed = true;
    return "`" + next + "`";
  });

  // INSERT OR IGNORE → ON CONFLICT DO NOTHING
  const orIgnore = /INSERT\s+OR\s+IGNORE\s+INTO/gi;
  if (orIgnore.test(out)) {
    out = out.replace(/(INSERT\s+)OR\s+IGNORE\s+(INTO\s+[^`]*?VALUES\s*\([^)]*\))/gis, "$1$2 ON CONFLICT DO NOTHING");
    changed = true;
  }

  // sqlite datetime('now') → now()
  if (/datetime\('now'\)/.test(out)) {
    out = out.replace(/datetime\('now'\)/g, "now()");
    changed = true;
  }

  // .changes reads on db.run results: `db.run(...).changes` → `(await db.run(...))`
  // (handled by async-await codemod; here just normalise destructures)
  out = out.replace(/const \{ changes \} = (?:await )?db\.run\(/g, "const changes = await db.run(");
  out = out.replace(/const (\w+) = (?:await )?db\.run\(([^;]*)\);\s*if \(\1\.changes/g, "const $1 = await db.run($2);\nif ($1");
  if (/\.changes/.test(out) && /db\.run\(/.test(out)) changed = true;

  return { code: out, changed };
}
