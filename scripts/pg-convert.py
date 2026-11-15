#!/usr/bin/env python3
"""
Step-01 mechanical sqlite→Postgres converter for DevFlow TS sources.

Handles, per file:
  1. `?` placeholders inside backtick SQL strings → $1..$N (string-literal aware)
  2. INSERT OR IGNORE INTO ... VALUES (...) → INSERT INTO ... VALUES (...) ON CONFLICT DO NOTHING
  3. datetime('now') → now()
  4. SELECT column lists → camelCase aliases (bare + table-qualified)
  5. `SELECT * FROM <table>` for known tables → explicit camelCase column list
  6. db.run(...).changes / { changes } = db.run(...) → await count forms
  7. JSON.stringify(x) arg to db.run → placeholder gets ::jsonb (best-effort)

Then TypeScript fixes are applied per-file by hand (async/await, property
renames). The script is idempotent-ish: run once per file, review the diff.
"""
import re, sys, pathlib

COLUMN_MAP = {
    "task_id": "taskId", "mr_url": "mrUrl", "mr_iid": "mrIid", "mr_branch": "mrBranch",
    "repo_url": "repoUrl", "gitlab_project_id": "gitlabProjectId", "current_node": "currentNode",
    "execution_mode": "executionMode", "repo_id": "repoId", "template_id": "templateId",
    "template_graph": "templateGraph", "trigger_payload": "triggerPayload",
    "worktree_dir": "worktreeDir", "parent_flow_id": "parentFlowId",
    "created_at": "createdAt", "updated_at": "updatedAt", "flow_id": "flowId",
    "node_key": "nodeKey", "attempt_id": "attemptId", "agent_id": "agentId",
    "agent_ref": "agentRef", "session_id": "sessionId", "prompt_override": "promptOverride",
    "join_mode": "joinMode", "node_id": "nodeId", "discussion_id": "discussionId",
    "file_path": "filePath", "resolved_by": "resolvedBy", "artifact_id": "artifactId",
    "meta_id": "metaId", "completed_by": "completedBy", "sub_flow_id": "subFlowId",
    "git_branch": "gitBranch", "run_ref": "runRef", "branch_id": "branchId",
    "input_tokens": "inputTokens", "output_tokens": "outputTokens",
    "cache_read_tokens": "cacheReadTokens", "cache_write_tokens": "cacheWriteTokens",
    "duration_ms": "durationMs", "cost_cents": "costCents", "cloud_url": "cloudUrl",
    "local_path": "localPath", "default_branch": "defaultBranch", "use_worktrees": "useWorktrees",
    "install_command": "installCommand", "skip_install": "skipInstall", "sync_paths": "syncPaths",
    "shared_dirs": "sharedDirs", "setup_command": "setupCommand",
    "worktree_timeout_ms": "worktreeTimeoutMs", "base_url": "baseUrl", "is_builtin": "isBuiltin",
    "schedule_next_at": "scheduleNextAt", "node_template_id": "nodeTemplateId",
    "input_map": "inputMap", "from_key": "fromKey", "to_key": "toKey",
    "hook_id": "hookId", "webhook_id": "webhookId", "parent_node": "parentNode",
    "issue_type": "issueType", "parent_key": "parentKey", "external_url": "externalUrl",
    "synced_at": "syncedAt", "delete_branch": "deleteBranch", "repo_path": "repoPath",
}
ORDERED = sorted(COLUMN_MAP, key=len, reverse=True)

# explicit SELECT lists for `SELECT * FROM <table>` (tables we SELECT * in code)
STAR_SELECTS = {
    "flows": 'id, task_id AS "taskId", name, status, mr_url AS "mrUrl", mr_iid AS "mrIid", mr_branch AS "mrBranch", repo_url AS "repoUrl", gitlab_project_id AS "gitlabProjectId", current_node AS "currentNode", execution_mode AS "executionMode", repo_id AS "repoId", template_id AS "templateId", template_graph AS "templateGraph", trigger_payload AS "triggerPayload", worktree_dir AS "worktreeDir", parent_flow_id AS "parentFlowId", kind, created_at AS "createdAt", updated_at AS "updatedAt"',
    "nodes": 'id, flow_id AS "flowId", node_key AS "nodeKey", type, status, attempt_id AS "attemptId", agent_id AS "agentId", agent_ref AS "agentRef", session_id AS "sessionId", prompt_override AS "promptOverride", label, config, join_mode AS "joinMode", input, output, created_at AS "createdAt", updated_at AS "updatedAt"',
    "tasks": 'id, type, key, summary, description, status, issue_type AS "issueType", priority, repo_url AS "repoUrl", parent_key AS "parentKey", external_url AS "externalUrl", raw, synced_at AS "syncedAt", fields',
    "artifacts": 'id, node_id AS "nodeId", flow_id AS "flowId", kind, version, content, meta, status, feedback, created_at AS "createdAt"',
    "comments": 'id, flow_id AS "flowId", mr_iid AS "mrIid", discussion_id AS "discussionId", author, body, file_path AS "filePath", line, status, resolved_by AS "resolvedBy", raw, created_at AS "createdAt", updated_at AS "updatedAt"',
    "messages": 'id, flow_id AS "flowId", node_key AS "nodeKey", thread, role, content, created_at AS "createdAt"',
    "events": 'id, flow_id AS "flowId", node_id AS "nodeId", type, message, data, created_at AS "createdAt"',
    "plan_steps": 'id, flow_id AS "flowId", artifact_id AS "artifactId", meta_id AS "metaId", position, title, detail, files, branch, status, origin, completed_by AS "completedBy", sub_flow_id AS "subFlowId", created_at AS "createdAt", updated_at AS "updatedAt"',
    "branches": 'id, flow_id AS "flowId", name, git_branch AS "gitBranch", title, status, mr_url AS "mrUrl", mr_iid AS "mrIid", "order", created_at AS "createdAt", updated_at AS "updatedAt"',
    "runs": 'id, flow_id AS "flowId", node_id AS "nodeId", agent_ref AS "agentRef", run_ref AS "runRef", branch_id AS "branchId", status, model, input_tokens AS "inputTokens", output_tokens AS "outputTokens", cache_read_tokens AS "cacheReadTokens", cache_write_tokens AS "cacheWriteTokens", duration_ms AS "durationMs", cost_cents AS "costCents", usage, created_at AS "createdAt", updated_at AS "updatedAt"',
    "repos": 'id, name, cloud_url AS "cloudUrl", local_path AS "localPath", default_branch AS "defaultBranch", use_worktrees AS "useWorktrees", install_command AS "installCommand", skip_install AS "skipInstall", sync_paths AS "syncPaths", shared_dirs AS "sharedDirs", setup_command AS "setupCommand", worktree_timeout_ms AS "worktreeTimeoutMs", created_at AS "createdAt", updated_at AS "updatedAt"',
    "node_templates": 'id, key, name, kind, version, description, icon, config, is_builtin AS "isBuiltin", template_id AS "templateId", created_at AS "createdAt", updated_at AS "updatedAt"',
    "flow_templates": 'id, name, description, version, is_builtin AS "isBuiltin", trigger, schedule_next_at AS "scheduleNextAt", hidden, created_at AS "createdAt", updated_at AS "updatedAt"',
    "flow_template_nodes": 'id, template_id AS "templateId", node_key AS "nodeKey", node_template_id AS "nodeTemplateId", label, trigger, join_mode AS "joinMode", config, input_map AS "inputMap", x, y, created_at AS "createdAt", updated_at AS "updatedAt"',
    "flow_template_edges": 'id, template_id AS "templateId", from_key AS "fromKey", to_key AS "toKey", kind, label, condition, created_at AS "createdAt", updated_at AS "updatedAt"',
    "hooks": 'id, template_id AS "templateId", flow_id AS "flowId", node_key AS "nodeKey", secret, filter, created_at AS "createdAt"',
    "hook_deliveries": 'hook_id AS "hookId", webhook_id AS "webhookId", created_at AS "createdAt"',
    "worktree_removals": 'id, flow_id AS "flowId", repo_path AS "repoPath", path, branch, delete_branch AS "deleteBranch", reason, created_at AS "createdAt"',
    "step_merges": 'id, flow_id AS "flowId", parent_flow_id AS "parentFlowId", parent_node AS "parentNode", branch, status, attempts, error, created_at AS "createdAt", updated_at AS "updatedAt"',
    "settings": 'key, value',
}

def convert_placeholders(sql):
    out, n, i = [], 0, 0
    in_s = in_d = False
    while i < len(sql):
        ch = sql[i]
        if in_s:
            out.append(ch)
            if ch == "'" and sql[i-1] != "\\":
                if i + 1 < len(sql) and sql[i+1] == "'":
                    out.append("'"); i += 2; continue
                in_s = False
            i += 1; continue
        if in_d:
            out.append(ch)
            if ch == '"' and sql[i-1] != "\\": in_d = False
            i += 1; continue
        if ch == "'": in_s = True; out.append(ch); i += 1; continue
        if ch == '"': in_d = True; out.append(ch); i += 1; continue
        if ch == "?":
            n += 1; out.append(f"${n}"); i += 1; continue
        out.append(ch); i += 1
    return "".join(out)

def alias_list(list_sql):
    out = list_sql
    for col in ORDERED:
        alias = COLUMN_MAP[col]
        # table-qualified: n.node_key → n.node_key AS "nodeKey"
        out = re.sub(rf"(\b\w+)\.{col}\b(?!\s+AS)(?![^\"]*\")", rf'\1.{col} AS "{alias}"', out)
        # bare: `, node_key,` or `, node_key\n` at end of list
        out = re.sub(rf"(?s)(?<=,)\s*{col}\s*(?=,)", f' {col} AS "{alias}",', out)
        out = re.sub(rf"(?s)(?<=,)\s*{col}\s*$", f' {col} AS "{alias}"', out)
        # first item in list: SELECT node_key, ...
        out = re.sub(rf"^\s*{col}\s*(?=,)", f'{col} AS "{alias}"', out)
        out = re.sub(rf"^\s*{col}\s*$", f'{col} AS "{alias}"', out)
    return out

def convert_sql(sql):
    s = sql
    # INSERT OR IGNORE
    s = re.sub(r"(INSERT\s+)OR\s+IGNORE\s+(INTO\s)", r"\1\2", s, flags=re.I)
    had_or_ignore = "ON CONFLICT" not in s and re.search(r"INSERT\s+INTO", s, re.I)
    if had_or_ignore and re.search(r"VALUES\s*\(", s, re.I):
        # append ON CONFLICT DO NOTHING after the values tuple's last closing paren
        s = re.sub(r"(\))\s*$", r"\1 ON CONFLICT DO NOTHING", s)
    s = s.replace("datetime('now')", "now()")
    if "?" in s:
        s = convert_placeholders(s)
    # SELECT * FROM <table>
    def star(m):
        pre, table = m.group(1), m.group(2).lower()
        if table in STAR_SELECTS:
            return f"{pre}{STAR_SELECTS[table]} FROM {m.group(2)}"
        return m.group(0)
    s = re.sub(r"(SELECT\s+(?:DISTINCT\s+)?)\*\s+FROM\s+(\w+)", star, s, flags=re.I)
    # alias explicit select lists (SELECT <cols> FROM) — only when it has snake cols
    def alias(m):
        body = m.group(2)
        if not any(f"\\b{c}\\b" and re.search(rf"(?<![\w\"]){c}(?![\w\"])", body) for c in ORDERED):
            return m.group(0)
        return m.group(1) + alias_list(body) + m.group(3)
    s = re.sub(r"(?is)(SELECT\s)([\s\S]*?)(\sFROM\s)", alias, s)
    return s

def convert_file(path):
    src = path.read_text()
    out = []
    i = 0
    changed = False
    while i < len(src):
        ch = src[i]
        if ch == "`":
            # template literal — find its end (no nested backticks in our SQL)
            j = i + 1
            while j < len(src):
                if src[j] == "\\": j += 2; continue
                if src[j] == "`": break
                j += 1
            body = src[i+1:j]
            if re.search(r"\b(SELECT|INSERT|UPDATE|DELETE)\b", body) and ("?" in body or "OR IGNORE" in body or "SELECT *" in body or re.search(r"(?i)SELECT\s+[\w\s,.\"]*\b\w+_\w+", body)):
                new_body = convert_sql(body)
                if new_body != body:
                    changed = True
                    body = new_body
            out.append("`" + body + "`")
            i = j + 1
        else:
            out.append(ch)
            i += 1
    code = "".join(out)
    # db.run(...).changes / destructured changes → await count
    code2 = re.sub(r"(?:const\s+)?\{\s*changes\s*\}\s*=\s*db\.run\(", "const __changes = await db.run(", code)
    if code2 != code:
        changed = True
        code = code2
    return code, changed

if __name__ == "__main__":
    for name in sys.argv[1:]:
        p = pathlib.Path(name)
        code, changed = convert_file(p)
        if changed:
            p.write_text(code)
            print("converted", name)
        else:
            print("no-sql-change", name)
