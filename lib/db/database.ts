import "server-only";

import SqliteDatabase from "better-sqlite3";
import fs from "fs";
import path from "path";
import type { z } from "zod";
import { config } from "../config";
import { DatabaseMigrationError } from "./database-migration-error";
import { bindDatabase } from "./db-access";
import { bindRowGateway } from "./row-gateway-access";
import { wireGitHostBuiltins } from "./wire-git-host-builtins";
import { RowGateway, type Repo } from "./rows";
import { SchemaMigrator } from "./schema-migrator";
import {
  EventStore,
  GitLabInstanceStore,
  JiraInstanceStore,
  MessageStore,
  RepoStore,
  SettingsStore,
} from "./stores";

export type { Repo } from "./rows";

/**
 * The application database (better-sqlite3, WAL mode).
 *
 * Owns the connection lifecycle, schema bootstrap and migrations, plus
 * domain stores (messages, events, settings, repos, integration instances).
 */
export class Database {
  private conn: SqliteDatabase.Database | null = null;
  /** Same-millisecond counter so event ids sort lexicographically in emit order. */
  private uidLastMs = 0;
  private uidSeqInMs = 0;

  readonly rows: RowGateway;
  readonly gitlabInstances: GitLabInstanceStore;
  readonly jiraInstances: JiraInstanceStore;

  private readonly schemaMigrator = new SchemaMigrator();
  private readonly messageStore: MessageStore;
  private readonly eventStore: EventStore;
  private readonly settingsStore: SettingsStore;
  private readonly repoStore: RepoStore;

  constructor() {
    bindDatabase(this);
    this.rows = new RowGateway(this);
    bindRowGateway(this.rows);
    this.messageStore = new MessageStore(this, this.rows);
    this.eventStore = new EventStore(this, this.rows);
    this.settingsStore = new SettingsStore(this);
    this.repoStore = new RepoStore(this, this.rows);
    this.gitlabInstances = new GitLabInstanceStore(this, this.rows);
    this.jiraInstances = new JiraInstanceStore(this, this.rows);
    wireGitHostBuiltins();
  }

  /** Run synchronous writes in one SQLite transaction. */
  transaction<T>(fn: () => T): T {
    return this.connection().transaction(fn)();
  }

  /** Lazily open (and migrate) the connection. */
  connection(): SqliteDatabase.Database {
    if (this.conn) return this.conn;
    const file = config.db.path();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let pending: SqliteDatabase.Database | null = null;
    try {
      pending = new SqliteDatabase(file);
      pending.pragma("journal_mode = WAL");
      this.bootstrap(pending);
      this.conn = pending;
      pending = null;
      return this.conn;
    } catch (err) {
      pending?.close();
      if (err instanceof DatabaseMigrationError) throw err;
      const cause = err instanceof Error ? err : undefined;
      throw new DatabaseMigrationError("Database bootstrap failed", { cause });
    }
  }

  private bootstrap(d: SqliteDatabase.Database): void {
    const schemaPath = config.db.schemaSqlPath();
    let schema: string;
    try {
      schema = fs.readFileSync(schemaPath, "utf8");
    } catch (err) {
      const cause = err instanceof Error ? err : undefined;
      throw new DatabaseMigrationError(`Failed to read schema at ${schemaPath}`, { cause });
    }
    d.exec(schema);
    this.schemaMigrator.runMigrations(d);
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

  get<T = unknown>(sql: string, ...args: unknown[]): T | undefined {
    return this.connection().prepare(sql).get(...args) as T | undefined;
  }

  all<T = unknown>(sql: string, ...args: unknown[]): T[] {
    return this.connection().prepare(sql).all(...args) as T[];
  }

  run(sql: string, ...args: unknown[]) {
    return this.connection().prepare(sql).run(...args);
  }

  addMessage(
    flowId: string,
    nodeKey: string | null,
    role: "user" | "assistant",
    content: string,
    thread?: string | null,
  ): void {
    this.messageStore.addMessage(flowId, nodeKey, role, content, thread);
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
  ): void {
    this.eventStore.emitEvent(flowId, nodeId, type, message, data);
  }

  getSetting<S extends z.ZodTypeAny>(key: string, schema: S, fallback: z.infer<S>): z.infer<S> {
    return this.settingsStore.getSetting(key, schema, fallback);
  }

  setSetting(key: string, value: unknown): void {
    this.settingsStore.setSetting(key, value);
  }

  listRepos(): Repo[] {
    return this.repoStore.listRepos();
  }

  repoById(id: string): Repo | undefined {
    return this.repoStore.repoById(id);
  }

  repoByCloudUrl(cloudUrl: string): Repo | undefined {
    return this.repoStore.repoByCloudUrl(cloudUrl);
  }

  normalizeRepoUrl(url: string): string {
    return this.repoStore.normalizeRepoUrl(url);
  }

  upsertRepo(input: Parameters<RepoStore["upsertRepo"]>[0]): Repo {
    return this.repoStore.upsertRepo(input);
  }

  deleteRepo(id: string): void {
    this.repoStore.deleteRepo(id);
  }

  countFlowsByRepoId(repoId: string): number {
    return this.repoStore.countFlowsByRepoId(repoId);
  }
}

export { DatabaseMigrationError } from "./database-migration-error";
export { SCHEMA_USER_VERSION } from "./schema-version";
export { SchemaMigrator } from "./schema-migrator";
export { TemplateSeeder } from "./template-seeder";
