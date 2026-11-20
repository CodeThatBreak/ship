/**
 * Engine-level test fixture for the overhaul characterization suite (step 00).
 *
 * One harness per test file. It seeds a task + flow on the built-in SDLC
 * template (`tpl_sdlc_loop`) or a minimal inline graph, drives the real
 * {@link FlowEngine}, and exposes read handles (statuses, outputs, events)
 * so tests assert at the engine-API level — never SQL writes or private
 * methods. Read helpers DO use SQL (reads are not engine behavior), matching
 * the repo's existing engine tests.
 *
 * Background work: the engine's `bg()` is fire-and-forget (step-00 risk).
 * The harness does NOT refactor it — tests either drive the synchronous
 * stage entry `engine.startNodeStage(...)` directly, or poll a read model
 * with {@link until} (the repo's existing drain convention from
 * `flowEngineChatAndManual.test.ts`).
 */
import type { Database } from "@/lib/db/app";
import type { TransitionKey } from "@/lib/engine/runtime/transitions/types/transitions";
import type { FlowEngine } from "@/lib/engine/flowEngine/flowEngine";
import type { TemplateStore } from "@/lib/engine/templates/templateStore/templateStore";
import type { TemplateGraph, TemplateInput } from "@/lib/engine/types/template";

// ── minimal inline graphs (fixtures; AGENTS §2.7 exempts test data) ──────────

export type InlineNodeInput = {
  key: string;
  /** built-in def key (plan/build/pipeline/review/resolve) or a seeded node_templates row id */
  def: string;
  trigger?: Record<string, unknown>;
  config?: Record<string, unknown>;
  input_map?: Record<string, unknown>;
};

export type InlineEdgeInput = {
  from: string;
  to: string;
  kind?: "next" | "loop";
  label?: string | null;
  condition?: string | null;
};

export type FlowHarnessDeps = {
  db: Database;
  flowEngine: FlowEngine;
  templateStore: TemplateStore;
};

export class FlowHarness {
  private flowCounter = 0;
  readonly repoUrl = "https://git.example.com/overhaul/repo.git";
  private repoId: string | null = null;

  constructor(private readonly deps: FlowHarnessDeps) {}

  /**
   * Register the harness repo with a local path so `cwd: repo` script nodes
   * and local-worktree helpers resolve it. Uses the repo service the engine
   * reads (`db.listRepos` / `repoByCloudUrl`). Idempotent per harness.
   */
  async registerRepoWithLocalPath(localPath: string): Promise<void> {
    const existing = (await this.deps.db.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM repos WHERE cloud_url=$1`,
      this.repoUrl,
    ))[0];
    if (existing) {
      this.repoId = existing.id;
      return;
    }
    this.repoId = this.deps.db.uid("repo_");
    await this.deps.db.prisma.$executeRawUnsafe(
      `INSERT INTO repos (id, name, cloud_url, local_path, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      this.repoId, "overhaul repo", this.repoUrl, localPath, this.deps.db.now(), this.deps.db.now(),
    );
  }

  /**
   * Seed a task + flow on the built-in SDLC template. `create()` does not
   * auto-start the manual plan node, so the flow sits at pending plan.
   */
  async seedSdlcFlow(): Promise<string> {
    return this.seedFlowFromTemplate(null);
  }

  /**
   * Seed a task + flow on an inline graph (built-in defs by catalog key, or
   * declarative `nt_*` row ids). The template rows are created with lint
   * skipped — characterization fixtures target runtime behavior, and a lint
   * rejection would hide the seam under test (the lint itself has its own
   * red test).
   */
  async seedInlineFlow(nodes: InlineNodeInput[], edges: InlineEdgeInput[]): Promise<string> {
    this.flowCounter += 1;
    const templateId = await this.deps.templateStore.create(
      {
        name: `overhaul harness ${this.flowCounter}`,
        trigger: { type: "manual", task_type: "jira" },
        nodes: nodes.map((n) => ({
          key: n.key,
          nodeTemplateId: n.def,
          trigger: n.trigger ?? { type: "auto" },
          ...(n.config ? { config: n.config } : {}),
          ...(n.input_map ? { input_map: n.input_map } : {}),
        })),
        edges: edges.map((e) => ({
          from: e.from,
          to: e.to,
          kind: e.kind ?? "next",
          label: e.label ?? null,
          condition: e.condition ?? null,
        })),
      } satisfies TemplateInput,
      { skipLint: true },
    );
    return this.seedFlowFromTemplate(templateId);
  }

  /** Seed a task + flow on a stored template (YAML-imported or inline-created). */
  async seedFlowFromTemplate(templateId: string | null): Promise<string> {
    this.flowCounter += 1;
    const taskId = `task_overhaul_${this.flowCounter}`;
    await this.deps.db.prisma.$executeRawUnsafe(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      taskId, "jira", `OVH-${this.flowCounter}`, "overhaul harness task", "open", "task", "P2",
    );
    return this.deps.flowEngine.create(taskId, this.repoUrl, `overhaul harness ${this.flowCounter}`, {
      ...(templateId ? { templateId } : {}),
      ...(this.repoId ? { repoId: this.repoId } : {}),
    });
  }

  // ── read handles (SQL reads only — never a write path) ─────────────────────

  async nodeStatus(flowId: string, nodeKey: string): Promise<string> {
    const row = (await this.deps.db.prisma.$queryRawUnsafe<{ status: string }[]>(
      `SELECT status FROM nodes WHERE flow_id=$1 AND node_key=$2`,
      flowId, nodeKey,
    ))[0];
    if (!row) throw new Error(`harness: no node row for ${flowId}/${nodeKey}`);
    return row.status;
  }

  async nodeOutput(flowId: string, nodeKey: string): Promise<Record<string, unknown> | null> {
    const row = (await this.deps.db.prisma.$queryRawUnsafe<{ output: unknown }[]>(
      `SELECT output FROM nodes WHERE flow_id=$1 AND node_key=$2`,
      flowId, nodeKey,
    ))[0];
    if (!row) throw new Error(`harness: no node row for ${flowId}/${nodeKey}`);
    // jsonb columns come back already parsed — shape-check, never re-parse
    const parsed: unknown = row.output;
    if (parsed == null) return null;
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`harness: ${nodeKey} output is not an object`);
    }
    return parsed as Record<string, unknown>;
  }

  /** Feed events (optionally one node, one type) in creation order. */
  async events(flowId: string, filter: { nodeKey?: string; type?: string } = {}): Promise<{ type: string; message: string }[]> {
    const nodeId = filter.nodeKey ? await this.nodeIdOf(flowId, filter.nodeKey) : undefined;
    const rows = await this.deps.db.prisma.$queryRawUnsafe<{ type: string; message: string }[]>(
      `SELECT type, message FROM events
       WHERE flow_id=$1
         AND ($2::text IS NULL OR node_id = $3)
         AND ($4::text IS NULL OR type = $5)
       ORDER BY created_at, id`,
      flowId,
      nodeId ?? null,
      nodeId ?? null,
      filter.type ?? null,
      filter.type ?? null,
    );
    return rows;
  }

  /** A flow-graph lookup that pins a status WITHOUT writing — tests use this to
   *  place a node in a non-default state through the engine (advanceFrom,
   *  startNodeStage, or the harness's stage helpers below). Raw status writes
   *  are exactly what the transition-authority step owns, so the harness
   *  never exposes one. */
  async graphForFlow(flowId: string): Promise<TemplateGraph | null> {
    return this.deps.templateStore.graphForFlow(flowId);
  }

  /**
   * Run one node stage synchronously through the engine's public stage entry
   * (`startNodeStage` claims pending/waiting and runs the def inline). This is
   * the test-only drain the step-00 file allows: drive the stage directly
   * instead of racing `bg()`.
   */
  async runStage(flowId: string, nodeKey: string): Promise<void> {
    await this.deps.flowEngine.startNodeStage(flowId, nodeKey);
  }

  /** Advance the edge evaluation from a node (public engine API). */
  async advance(flowId: string, fromKey: string): Promise<void> {
    await this.deps.flowEngine.advanceFrom(flowId, fromKey);
  }

  /**
   * Claim a node into `running` through the engine's public claim, for tests
   * that need an in-flight node (duplicate-trigger, reconcile). The caller is
   * responsible for the node def's run being scripted on the fake agent port.
   */
  async claimNode(flowId: string, nodeKey: string, key: TransitionKey): Promise<void> {
    await this.deps.flowEngine.claimNode(flowId, nodeKey, key);
  }

  /**
   * Fixture setup ONLY: place a node in a state the engine can't cheaply reach
   * in the fixture (e.g. a terminal status mid-cycle for a loop-reset test).
   * Deliberately named so it is never mistaken for an engine-behavior path —
   * assertions still read through the engine's own state transitions. Mirrors
   * the direct status writes the repo's existing engine tests do inline.
   */
  async setNodeForFixture(flowId: string, nodeKey: string, status: string): Promise<void> {
    await this.deps.db.prisma.$executeRawUnsafe(
      `UPDATE nodes SET status=$1, updated_at=$2 WHERE flow_id=$3 AND node_key=$4`,
      status, this.deps.db.now(), flowId, nodeKey,
    );
  }

  /** Fixture setup ONLY: place a node terminal with an output (decision picks). */
  async setNodeOutputForFixture(
    flowId: string,
    nodeKey: string,
    status: string,
    output: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.db.prisma.$executeRawUnsafe(
      `UPDATE nodes SET status=$1, output=$2, updated_at=$3 WHERE flow_id=$4 AND node_key=$5`,
      status, JSON.stringify(output), this.deps.db.now(), flowId, nodeKey,
    );
  }

  private async nodeIdOf(flowId: string, nodeKey: string): Promise<string> {
    const row = (await this.deps.db.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM nodes WHERE flow_id=$1 AND node_key=$2`,
      flowId, nodeKey,
    ))[0];
    if (!row) throw new Error(`harness: no node row for ${flowId}/${nodeKey}`);
    return row.id;
  }
}

/** Poll a read model until the engine's background work settles (or fail
 *  loudly). Mirrors the `until` helper in flowEngineChatAndManual.test.ts —
 *  the repo's existing answer to fire-and-forget `bg()`. */
export async function until(
  cond: () => boolean | Promise<boolean>,
  what: string,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await cond()) return;
    if (Date.now() > deadline) throw new Error(`harness: timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
