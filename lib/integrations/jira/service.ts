import "server-only";

import { ConflictError } from "../../errors";
import { truncateUpstreamBody } from "../../engine/ports/git-host-errors";
import type { JiraInstanceStore } from "../../db/stores";
import { type JiraInstance } from "../../db/rows";
import { jiraAuthHeaders, jiraAuthModeForInstance, jiraMyselfPath, type JiraAuthMode } from "./api-profile";
import { JIRA_HTTP_TIMEOUT_MS } from "./constants";

export type { JiraInstance } from "../../db/rows";

export { maskToken } from "../../mask-token";

const tryMyself = async (
  baseUrl: string,
  mode: JiraAuthMode,
  headers: HeadersInit,
): Promise<{ ok: boolean; detail: string; mode?: JiraAuthMode }> => {
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}${jiraMyselfPath(mode)}`, {
    headers,
    signal: AbortSignal.timeout(JIRA_HTTP_TIMEOUT_MS),
  });
  if (!res.ok) {
    return {
      ok: false,
      detail: `HTTP ${res.status}: ${truncateUpstreamBody(await res.text())}`,
    };
  }
  const user = (await res.json()) as { displayName?: string; name?: string };
  return {
    ok: true,
    detail: `Authenticated as ${user.displayName ?? user.name ?? "user"} (${mode === "cloud_basic" ? "Cloud" : "Data Center"})`,
    mode,
  };
};

/**
 * Jira integration: registry of configured instances (DB-backed, managed from
 * Settings → Integrations → Task) plus the credential checks the task
 * provider and the settings API go through.
 */
export class JiraService {
  constructor(private readonly instances: JiraInstanceStore) {}

  // ── instance registry ────────────────────────────────────────────────────
  listInstances(): JiraInstance[] {
    return this.instances.list();
  }

  addInstance(input: { name?: string | null; base_url: string; email: string; token: string }): JiraInstance {
    if (this.listInstances().length > 0) {
      throw new ConflictError(
        "Only one Jira instance is supported today. Remove the existing instance before adding another.",
      );
    }
    return this.instances.add(input);
  }

  /** Update by id; a blank/absent token or email keeps the stored one. */
  updateInstance(
    id: string,
    input: { name?: string | null; base_url?: string; email?: string; token?: string }
  ): void {
    const existing = this.listInstances().find((i) => i.id === id);
    if (!existing) throw new Error(`jira instance not found: ${id}`);
    this.instances.update(id, input, existing);
  }

  deleteInstance(id: string): void {
    this.instances.delete(id);
  }

  /**
   * The instance the task provider talks to. Only one instance may be registered.
   */
  active(): JiraInstance | undefined {
    return this.listInstances()[0];
  }

  authMode(inst?: JiraInstance): JiraAuthMode {
    const resolved = inst ?? this.active();
    if (!resolved) throw new Error("no jira instance configured");
    return jiraAuthModeForInstance(resolved);
  }

  /** True when at least one instance is registered. */
  configured(): boolean {
    return this.listInstances().length > 0;
  }

  /** Quick reachability/auth check used by the settings UI. */
  async testInstance(baseUrl: string, email: string, token: string): Promise<{ ok: boolean; detail: string }> {
    const trimmedBase = baseUrl.replace(/\/+$/, "");
    const creds = { email: email.trim(), token };
    try {
      const preferred = jiraAuthModeForInstance({ base_url: trimmedBase });
      const modes: JiraAuthMode[] =
        preferred === "cloud_basic" ? ["cloud_basic", "dc_bearer"] : ["dc_bearer", "cloud_basic"];
      let lastDetail = "";
      for (const mode of modes) {
        const result = await tryMyself(trimmedBase, mode, jiraAuthHeaders(creds, mode));
        if (result.ok) return { ok: true, detail: result.detail };
        lastDetail = result.detail;
      }
      return { ok: false, detail: lastDetail || "Authentication failed" };
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "TimeoutError") {
        return { ok: false, detail: `Timed out after ${JIRA_HTTP_TIMEOUT_MS}ms` };
      }
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }
}
