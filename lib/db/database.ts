import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import type { z } from "zod";
import { AtRestCipher } from "./atRestCipher";
import { IntegrationSecretStore } from "./integrationSecretStore";
import {
  EventStore,
  GitLabInstanceStore,
  JiraInstanceStore,
  MessageStore,
  RepoStore,
  SettingsStore,
} from "./stores/storeExports";
import { bindDatabase } from "./dbAccess";
import { wireGitHostBuiltins } from "./wireGitHostBuiltins";

import type { Repo } from "./rows";
export type { Repo } from "./rows";

/** Options a caller can pass to raw queries — inside a transaction, the tx client. */
export type QueryExecutor = PrismaClient | Prisma.TransactionClient;

/**
 * The application database (Postgres, via Prisma) — composition root for the
 * domain stores.
 *
 * ORM-first (decision Q1): engine stores receive the typed Prisma client via
 * this facade and all new persistence goes through the Prisma ORM query API.
 * Raw SQL survives ONLY inside the contained invariant sites (the
 * orm-migration containment list — atomic claims with `FOR UPDATE SKIP
 * LOCKED`, lease/interval arithmetic on DB-server time, the transition
 * authority's attempt-fenced CAS, advisory locks); each sits behind a named
 * method that calls `$queryRaw*`/`$executeRaw*` on the client directly —
 * there is no generic raw-query helper on this facade anymore, so a new raw
 * statement outside the containment list is a deliberate, reviewable edit
 * (Task 12's lint rule enforces it).
 *
 * `transaction(fn)` maps to `prisma.$transaction`; async I/O stays outside
 * the callback.
 */
export class Database {
  /** Same-millisecond counter so event ids sort lexicographically in emit order. */
  private uidLastMs = 0;
  private uidSeqInMs = 0;

  readonly integrationSecrets: IntegrationSecretStore;
  readonly gitlabInstances: GitLabInstanceStore;
  readonly jiraInstances: JiraInstanceStore;

  private readonly messageStore: MessageStore;
  private readonly eventStore: EventStore;
  private readonly settingsStore: SettingsStore;
  private readonly repoStore: RepoStore;

  constructor(readonly prisma: PrismaClient) {
    bindDatabase(this);
    this.messageStore = new MessageStore(this);
    this.eventStore = new EventStore(this);
    this.settingsStore = new SettingsStore(this);
    this.repoStore = new RepoStore(this);
    const atRestCipher = AtRestCipher.fromConfig();
    this.integrationSecrets = new IntegrationSecretStore(this, atRestCipher);
    this.gitlabInstances = new GitLabInstanceStore(this, this.integrationSecrets);
    this.jiraInstances = new JiraInstanceStore(this, this.integrationSecrets);
    wireGitHostBuiltins();
  }

  /**
   * Run async writes in one Postgres transaction (`prisma.$transaction`).
   * The callback receives the tx client; pass it to store calls that must
   * join the transaction. Never await network/agent/git I/O inside the
   * callback (same rule as the better-sqlite3 era, now enforced by types).
   */
  transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    tx?: Prisma.TransactionClient,
  ): Promise<T> {
    if (tx) return fn(tx);
    return this.prisma.$transaction((inner) => fn(inner));
  }

  now(): string {
    return new Date().toISOString();
  }

  uid(prefix = ""): string {
    const ms = Date.now();
    if (ms !== this.uidLastMs) {
      this.uidLastMs = ms;
      this.uidSeqInMs = 0;
    }
    const seq = this.uidSeqInMs++;
    const seqPart = seq.toString(36).padStart(4, "0");
    const entropy = Math.random().toString(36).slice(2, 6);
    return `${prefix}${ms.toString(36)}${seqPart}${entropy}`;
  }

  addMessage(
    flowId: string,
    nodeKey: string | null,
    role: "user" | "assistant",
    content: string,
    thread?: string | null,
  ): Promise<void> {
    return this.messageStore.addMessage(flowId, nodeKey, role, content, thread);
  }

  listMessages(flowId: string) {
    return this.messageStore.listMessages(flowId);
  }

  listEvents(flowId: string, after: string, limit: number) {
    return this.eventStore.listEvents(flowId, after, limit);
  }

  listEventsTail(flowId: string, limit: number) {
    return this.eventStore.listEventsTail(flowId, limit);
  }

  emitEvent(
    flowId: string,
    nodeId: string | null,
    type: string,
    message: string,
    data?: Record<string, unknown>,
    tx?: QueryExecutor,
  ): Promise<void> {
    return this.eventStore.emitEvent(flowId, nodeId, type, message, data, tx);
  }

  getSetting<S extends z.ZodTypeAny>(
    key: string,
    schema: S,
    fallback: z.infer<S>,
    tx?: QueryExecutor,
  ): Promise<z.infer<S>> {
    return this.settingsStore.getSetting(key, schema, fallback, tx);
  }

  setSetting(key: string, value: unknown, tx?: QueryExecutor): Promise<void> {
    return this.settingsStore.setSetting(key, value, tx);
  }

  listRepos(): Promise<Repo[]> {
    return this.repoStore.listRepos();
  }

  repoById(id: string): Promise<Repo | undefined> {
    return this.repoStore.repoById(id);
  }

  repoByCloudUrl(cloudUrl: string): Promise<Repo | undefined> {
    return this.repoStore.repoByCloudUrl(cloudUrl);
  }

  normalizeRepoUrl(url: string): string {
    return this.repoStore.normalizeRepoUrl(url);
  }

  upsertRepo(input: Parameters<RepoStore["upsertRepo"]>[0]): Promise<Repo> {
    return this.repoStore.upsertRepo(input);
  }

  deleteRepo(id: string): Promise<void> {
    return this.repoStore.deleteRepo(id);
  }

  countFlowsByRepoId(repoId: string): Promise<number> {
    return this.repoStore.countFlowsByRepoId(repoId);
  }
}

export { DatabaseMigrationError } from "./databaseMigrationError";
export { TemplateSeeder } from "./templateSeeder";
