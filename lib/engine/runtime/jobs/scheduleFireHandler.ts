import "server-only";

import type { Database } from "../../../db/database";
import { db } from "../../../db/app";
import { flowEngine } from "../../flowEngine";
import { nextScheduleFireAt } from "../scheduleTrigger";
import { JobQueue } from "./jobQueue";
import { scheduleFirePayloadSchema } from "./schemas/jobPayloads";
import type { JobRecord } from "./types/job";

/**
 * ScheduleFireHandler — dispatches a claimed `schedule_fire` job: fire the
 * template (one new flow per fire), then advance `schedule_next_at` and mark
 * the job done in ONE transaction. This inverts the old advance-then-fire
 * order (step 03 task 5): a crash no longer silently drops a fire — the
 * claimed job's lease expiry re-claims and re-fires (at-least-once), and the
 * schedule only advances on a completed fire.
 *
 * Must never: advance the schedule before the fire lands (drops fires on
 * crash), run `startFromTemplate` inside the transaction (async I/O stays
 * outside — coding-patterns §3.3), or retry a fire whose job already
 * exhausted its budget (the JobQueue fails it loudly with an event).
 */
export class ScheduleFireHandler {
  constructor(
    private readonly jobs: JobQueue,
    private readonly database: Database = db,
  ) {}

  async handle(job: JobRecord): Promise<void> {
    const parsed = scheduleFirePayloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      throw new Error(`schedule_fire payload failed validation: ${parsed.error.message}`);
    }
    const { templateId, fireAt, intervalMin } = parsed.data;
    // the fire provides nothing (the start contract's defaults apply) — an
    // ad-hoc body would fail the start contract's strict shape check
    await flowEngine.startFromTemplate(templateId, {});
    await this.database.transaction(async (tx) => {
      const nextAt = nextScheduleFireAt(fireAt, Date.now(), intervalMin);
      await tx.flowTemplate.update({
        where: { id: templateId },
        data: { scheduleNextAt: new Date(nextAt) },
      });
      await this.jobs.complete(job.id, tx);
    });
  }
}
