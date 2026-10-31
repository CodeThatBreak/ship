import "server-only";

import type SqliteDatabase from "better-sqlite3";
import { AtRestCipher } from "./at-rest-cipher";
import { DatabaseMigrationError } from "./database-migration-error";
import { sealIntegrationSecretsAtRest } from "./migrations/seal-integration-secrets";
import { SCHEMA_USER_VERSION } from "./schema-version";
import { TemplateSeeder } from "./template-seeder";

/** Numbered migrations gated on `PRAGMA user_version` (each step is one transaction). */
export class SchemaMigrator {
  constructor(private readonly templateSeeder: TemplateSeeder = new TemplateSeeder()) {}

  runMigrations(d: SqliteDatabase.Database): void {
    let version = d.pragma("user_version", { simple: true }) as number;
    while (version < SCHEMA_USER_VERSION) {
      const next = version + 1;
      try {
        d.transaction(() => {
          if (next === 1) {
            this.templateSeeder.seed(d);
          } else if (next === 2) {
            const cols = d.prepare(`PRAGMA table_info(nodes)`).all() as { name: string }[];
            if (!cols.some((c) => c.name === "attempt_id")) {
              d.exec(`ALTER TABLE nodes ADD COLUMN attempt_id TEXT`);
            }
          } else if (next === 3) {
            const cols = d.prepare(`PRAGMA table_info(branches)`).all() as { name: string }[];
            if (!cols.some((c) => c.name === "git_branch")) {
              d.exec(`ALTER TABLE branches ADD COLUMN git_branch TEXT`);
            }
          } else if (next === 4) {
            const cols = d.prepare(`PRAGMA table_info(flows)`).all() as { name: string }[];
            if (!cols.some((c) => c.name === "template_graph")) {
              d.exec(`ALTER TABLE flows ADD COLUMN template_graph TEXT`);
            }
          } else if (next === 5) {
            d.exec(`
              CREATE INDEX IF NOT EXISTS idx_runs_node ON runs(node_id);
              CREATE INDEX IF NOT EXISTS idx_runs_flow ON runs(flow_id);
              CREATE INDEX IF NOT EXISTS idx_runs_run_ref ON runs(run_ref);
              CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
              CREATE INDEX IF NOT EXISTS idx_flows_parent ON flows(parent_flow_id) WHERE parent_flow_id IS NOT NULL;
              CREATE INDEX IF NOT EXISTS idx_flows_gitlab_project ON flows(gitlab_project_id) WHERE gitlab_project_id IS NOT NULL;
              CREATE INDEX IF NOT EXISTS idx_flows_status ON flows(status);
              CREATE INDEX IF NOT EXISTS idx_flows_template ON flows(template_id) WHERE template_id IS NOT NULL;
              CREATE INDEX IF NOT EXISTS idx_flows_repo ON flows(repo_id) WHERE repo_id IS NOT NULL;
              CREATE INDEX IF NOT EXISTS idx_plan_steps_sub_flow ON plan_steps(sub_flow_id) WHERE sub_flow_id IS NOT NULL;
              CREATE INDEX IF NOT EXISTS idx_step_merges_flow ON step_merges(flow_id);
              CREATE INDEX IF NOT EXISTS idx_hook_deliveries_created ON hook_deliveries(created_at);
            `);
          } else if (next === 6) {
            sealIntegrationSecretsAtRest(d, AtRestCipher.fromConfig());
          } else {
            throw new Error(`No migration defined for user_version ${next}`);
          }
          d.pragma(`user_version = ${next}`);
        })();
      } catch (err) {
        const cause = err instanceof Error ? err : undefined;
        throw new DatabaseMigrationError(`Migration to user_version ${next} failed`, { cause });
      }
      version = next;
    }
  }
}
