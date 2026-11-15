import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "./prismaClient";
import { bindDatabase } from "./dbAccess";
import { bindRowGateway } from "./rowGatewayAccess";
import { wireGitHostBuiltins } from "./wireGitHostBuiltins";
import { RowGateway, type Repo } from "./rows";
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

export type { Repo } from "./rows";

/** Options a caller can pass to raw queries — inside a transaction, the tx client. */
export type QueryExecutor = PrismaClient | Prisma.TransactionClient;

/**
 * The application database (Postgres, via Prisma).
 *
 * Thin async facade over the PrismaClient singleton (`lib/db/prismaClient.ts`)
 * so the sync→async call-site conversion is mechanical: `db.get/all/run` are
 * raw-SQL helpers returning camelCase rows, and `transaction(fn)` maps to
 * `prisma.$transaction` (async I/O stays outside the callback — same rule as
 * the better-sqlite3 era, now enforced by types). Domain stores are
 * constructor-injected here; the wider composition root lands incrementally
 * through step 09 (decision Q9).
 */
export class Database {
  /** Same-millisecond counter so event ids sort lexicographically in emit order. */
  private uidLastMs = 0;
  private uidSeqInMs = 0;

  readonly rows: RowGateway;
  readonly integrationSecrets: IntegrationSecretStore;
  readonly gitlabInstances: GitLabInstanceStore;
  readonly jiraInstances: JiraInstanceStore;

  private readonly messageStore: MessageStore;
  private readonly eventStore: EventStore;
  private readonly settingsStore: SettingsStore;
  private readonly repoStore: RepoStore;

  constructor(readonly prisma: PrismaClient) {
    bindDatabase(this);
    this.rows = new RowGateway(this);
    bindRowGateway(this.rows);
    this.messageStore = new MessageStore(this, this.rows);
    this.eventStore = new EventStore(this, this.rows);
    this.settingsStore = new SettingsStore(this);
    this.repoStore = new RepoStore(this, this.rows);
    const atRestCipher = AtRestCipher.fromConfig();
    this.integrationSecrets = new IntegrationSecretStore(this, atRestCipher);
    this.gitlabInstances = new GitLabInstanceStore(this, this.rows, this.integrationSecrets);
    this.jiraInstances = new JiraInstanceStore(this, this.rows, this.integrationSecrets);
    wireGitHostBuiltins();
  }

  /**
   * Run async writes in one Postgres transaction (`prisma.$transaction`).
   * The callback receives the tx client; pass it as the executor to any
   * `db.get/all/run` calls that must join the transaction. Never await
   * network/agent/git I/O inside the callback.
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

  async get<T = unknown>(
    sql: string,
    ...args: unknown[]
  ): Promise<T | undefined> {
    const rows = await this.prisma.$queryRawUnsafe<T[]>(sql, ...args);
    return rows[0];
  }

  async all<T = unknown>(sql: string, ...args: unknown[]): Promise<T[]> {
    return this.prisma.$queryRawUnsafe<T[]>(sql, ...args);
  }

  /** Execute a write. Returns the affected row count (like sqlite's `changes`). */
  async run(sql: string, ...args: unknown[]): Promise<number> {
    return this.prisma.$executeRawUnsafe(sql, ...args);
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
  ): Promise<void> {
    return this.eventStore.emitEvent(flowId, nodeId, type, message, data);
  }

  getSetting<S extends z.ZodTypeAny>(
    key: string,
    schema: S,
    fallback: z.infer<S>,
  ): Promise<z.infer<S>> {
    return this.settingsStore.getSetting(key, schema, fallback);
  }

  setSetting(key: string, value: unknown): Promise<void> {
    return this.settingsStore.setSetting(key, value);
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
