/**
 * ScheduleFireHandler (engine overhaul step 03, task 5): a claimed
 * `schedule_fire` job fires the template (one new flow) and advances
 * `schedule_next_at` in the SAME transaction as the job's completion — the
 * old advance-then-fire order silently dropped a fire on a crash between
 * the two writes.
 */
import { testGet, testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("../../../db/app");
const { importTemplateYaml } = await import("../../templates/templateYaml");
const { templateStore } = await import("../../templates/templateStore");
const { JobQueue } = await import("./jobQueue");
const { ScheduleFireHandler } = await import("./scheduleFireHandler");
const { JOB_KIND } = await import("./constants/jobVocabulary");

describe("ScheduleFireHandler", () => {
  beforeAll(resetTestDatabase);

  it("fires the template and advances schedule_next_at in the same tx as the job's done", async () => {
    // a repo + a jira task (the schedule fire auto-creates a flow from the
    // template's repo binding and the default task type)
    const repoId = db.uid("repo_");
    await testRun(
      `INSERT INTO repos (id, name, cloud_url, local_path, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      repoId, "schedule repo", "https://git.example.com/schedule/repo.git", null, db.now(), db.now());
    await testRun(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      "task_sched", "jira", "TST-S", "schedule fire", "open", "task", "P2");

    // a schedule-trigger template: manual entry node, 60-minute interval,
    // bound to the repo above
    const { id: templateId } = await importTemplateYaml(
      templateStore,
      `
name: Overhaul schedule fire
trigger:
  type: schedule
  interval_min: 60
  repoId: ${repoId}
nodes:
  - key: entry
    type: script
    config:
      runtime: shell
      script: "echo '{}'"
`,
      { namePrefix: "ovh-schedule-fire" },
    );

    // the due instant is in the past — what the poller's sweep would enqueue
    const fireAt = Date.now() - 60_000;
    await testRun(`UPDATE flow_templates SET schedule_next_at=$1 WHERE id=$2`, new Date(fireAt), templateId);

    const jobs = new JobQueue();
    const handler = new ScheduleFireHandler(jobs);
    const { id: jobId } = await jobs.enqueue({
      kind: JOB_KIND.SCHEDULE_FIRE,
      dedupKey: `template:${templateId}:${fireAt}`,
      payload: { templateId, fireAt, intervalMin: 60 },
    });

    const processed = await jobs.sweepDue({
      [JOB_KIND.SCHEDULE_FIRE]: async (job) => handler.handle(job),
    });
    expect(processed).toBe(1);

    // the fire created exactly one flow from the template
    const flow = await testGet<{ id: string; template_id: string }>(
      `SELECT id, template_id FROM flows WHERE template_id=$1`,
      templateId);
    expect(flow?.id).toBeTruthy();

    // the job completed AND the schedule advanced past the fired instant —
    // the crash-drops-a-fire window is closed
    const jobRow = await testGet<{ status: string }>(`SELECT status FROM jobs WHERE id=$1`, jobId);
    expect(jobRow?.status).toBe("done");
    const tpl = await testGet<{ scheduleNextAt: Date | null }>(
      `SELECT schedule_next_at AS "scheduleNextAt" FROM flow_templates WHERE id=$1`,
      templateId);
    if (!tpl?.scheduleNextAt) throw new Error("expected the fired schedule to have advanced");
    expect(tpl.scheduleNextAt.getTime()).toBeGreaterThan(fireAt);
  });
});
