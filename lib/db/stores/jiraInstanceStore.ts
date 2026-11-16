import "server-only";

import { JiraInstanceRow, type JiraInstance } from "../rows";
import type { Database } from "../database";
import type { IntegrationSecretStore } from "../integrationSecretStore";

export type JiraInstanceMeta = Omit<JiraInstance, "token">;

const metaSchema = JiraInstanceRow.omit({ token: true });

/** Jira instances (cloud sites + self-hosted): base URL → credentials. */
export class JiraInstanceStore {
  constructor(
    private readonly db: Database,
    private readonly secrets: IntegrationSecretStore,
  ) {}

  async listMeta(): Promise<JiraInstanceMeta[]> {
    const rows = await this.db.prisma.jiraInstance.findMany({
      orderBy: { baseUrl: "asc" },
      select: { id: true, name: true, baseUrl: true, email: true, createdAt: true },
    });
    const decoded: JiraInstanceMeta[] = [];
    for (const raw of rows) {
      const result = metaSchema.safeParse(raw);
      if (result.success) decoded.push(result.data);
    }
    return decoded;
  }

  async get(id: string): Promise<JiraInstance | undefined> {
    const metas = await this.listMeta();
    const meta = metas.find((row) => row.id === id);
    if (!meta) return undefined;
    return { ...meta, token: await this.secrets.readJiraToken(id) };
  }

  readToken(id: string): Promise<string> {
    return this.secrets.readJiraToken(id);
  }

  async add(input: { name?: string | null; baseUrl: string; email: string; token: string }): Promise<JiraInstance> {
    const baseUrl = input.baseUrl.trim().replace(/\/+$/, "");
    const id = this.db.uid("jri_");
    // one Date for the row and the return value (see gitlabInstanceStore)
    const createdAt = new Date();
    const sealed = this.secrets.seal(input.token);
    await this.db.prisma.jiraInstance.create({
      data: { id, name: input.name ?? null, baseUrl, email: input.email.trim(), token: sealed, createdAt },
    });
    return {
      id,
      name: input.name ?? null,
      baseUrl,
      email: input.email.trim(),
      token: input.token,
      createdAt: createdAt.toISOString(),
    };
  }

  async update(
    id: string,
    input: { name?: string | null; baseUrl?: string; email?: string; token?: string },
    existing: JiraInstance,
  ): Promise<void> {
    const token = input.token || existing.token;
    await this.db.prisma.jiraInstance.update({
      where: { id },
      data: {
        name: input.name ?? existing.name,
        baseUrl: (input.baseUrl ?? existing.baseUrl).trim().replace(/\/+$/, ""),
        email: (input.email ?? existing.email).trim(),
        token: this.secrets.seal(token),
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.db.prisma.jiraInstance.deleteMany({ where: { id } });
  }
}
