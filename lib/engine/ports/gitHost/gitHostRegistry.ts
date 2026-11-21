import "server-only";

import { RUN_MODE } from "../../../../constants/execution";
import { HARNESS_KEYS } from "../../constants/harnesses";
import type { GitHostService } from "./types/gitHost";

/**
 * The git-host registry — the engine's single seam for anything host-shaped.
 * Mirrors `TaskProviderRegistry` (lib/engine/tasks/registry.ts): adding a host
 * = one adapter file + one `register()` line here.
 */
export class GitHostRegistry {
  private readonly registry = new Map<string, GitHostService>();

  private assertReady(): void {
    if (this.registry.size === 0) {
      throw new Error("Git host registry is empty — import @/lib/db before using gitHostRegistry");
    }
  }

  register(service: GitHostService): void {
    if (this.registry.has(service.kind)) {
      throw new Error(`duplicate git host kind: ${service.kind}`);
    }
    this.registry.set(service.kind, service);
  }

  /** Get a host by kind, or throw. */
  get(kind: string): GitHostService {
    this.assertReady();
    const svc = this.registry.get(kind);
    if (!svc) throw new Error(`unknown git host kind: ${kind}`);
    return svc;
  }

  /** Get a host by kind, or undefined. */
  maybe(kind: string): GitHostService | undefined {
    return this.registry.get(kind);
  }

  /** All registered hosts (registration order). */
  list(): GitHostService[] {
    this.assertReady();
    return [...this.registry.values()];
  }

  /**
   * The host that serves the given repo URL, or throw. A `dry-run`
   * execution-mode flow (task 27, design §7) resolves the simulation
   * harness's fake host explicitly by mode — its MRs/pipelines are
   * fabrications, so no real host is ever touched; the fake claims no repos,
   * so it can never win the URL-based resolution below.
   */
  async forRepo(repoUrl: string, executionMode?: string | null): Promise<GitHostService> {
    this.assertReady();
    if (executionMode === RUN_MODE.DRY_RUN) return this.get(HARNESS_KEYS.DRY_RUN);
    for (const svc of this.list()) {
      if (await svc.ownsRepo(repoUrl)) return svc;
    }
    throw new Error(
      `no git host configured for repo "${repoUrl}" — add one on the Settings page`
    );
  }
}
