import { describe, expect, it } from "vitest";

import type { HostJob } from "../../../../ports/gitHost";
import { assembleFixLogs } from "./fixLogs";
import { FIX_JOB_LOGS, FIX_JOB_TRACE_TAIL } from "../constants/waiting";

const job = (id: number, name = `job-${id}`): HostJob => ({ id, name, status: "failed", manual: false });

describe("assembleFixLogs", () => {
  it("fences each failed job's log and reports no truncation when nothing was capped", async () => {
    const { logs, truncations } = await assembleFixLogs(
      [job(1)],
      async () => "error: build failed",
    );
    expect(logs).toContain("===== job job-1 (#1) =====");
    expect(logs).toContain('<untrusted-data source="CI job job-1 (#1) log">');
    expect(logs).toContain("error: build failed");
    expect(truncations).toEqual([]);
  });

  it("tail-caps a long trace loudly, in-prompt and in the truncation signal", async () => {
    const long = `head-${"x".repeat(FIX_JOB_TRACE_TAIL)}`;
    const { logs, truncations } = await assembleFixLogs(
      [job(7, "test")],
      async () => long,
    );
    expect(truncations).toEqual([
      `CI job test (#7) log tail-capped to the last ${FIX_JOB_TRACE_TAIL} of ${long.length} characters`,
    ]);
    // the tail kept the END of the trace, the head was dropped
    expect(logs).toContain("[truncated to the last " + FIX_JOB_TRACE_TAIL + " of " + long.length + " characters");
    expect(logs).not.toContain("head-");
  });

  it("drops failed jobs beyond the log budget with a loud note and one truncation entry", async () => {
    const failed = Array.from({ length: FIX_JOB_LOGS + 2 }, (_, i) => job(i + 1));
    const { logs, truncations } = await assembleFixLogs(
      failed,
      async () => "short trace",
    );
    expect(truncations).toEqual([
      `failed-job logs capped to the first ${FIX_JOB_LOGS} job(s) — 2 failed job(s) omitted`,
    ]);
    expect(logs).toContain(
      `[only the first ${FIX_JOB_LOGS} failed jobs' logs are included — 2 failed job(s) were omitted from this prompt]`,
    );
    // only the first jobs were fetched at all
    expect(logs).toContain("job-1 (#1)");
    expect(logs).toContain(`job-${FIX_JOB_LOGS} (#${FIX_JOB_LOGS})`);
    expect(logs).not.toContain("job-4 (#4)");
  });

  it("an unfetchable trace stays empty without pretending it was truncated", async () => {
    const { logs, truncations } = await assembleFixLogs(
      [job(9)],
      async () => {
        throw new Error("trace unavailable");
      },
    );
    expect(logs).toContain("===== job job-9 (#9) =====\n");
    expect(truncations).toEqual([]);
  });
});
