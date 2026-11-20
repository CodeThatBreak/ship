import "server-only";

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

  /** The host that serves the given repo URL, or throw. */
  async forRepo(repoUrl: string): Promise<GitHostService> {
    this.assertReady();
    for (const svc of this.list()) {
      if (await svc.ownsRepo(repoUrl)) return svc;
    }
    throw new Error(
      `no git host configured for repo "${repoUrl}" — add one on the Settings page`
    );
  }
}
