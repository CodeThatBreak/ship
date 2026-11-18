import { NextResponse } from "next/server";
import { db } from "@/lib/db/app";
import { writerLockHeld } from "@/lib/engine/runtime/locks/utils/writerLockStatus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Liveness + writer-lock probe (engine overhaul step 03): `writer` is shared
 * truth read from `pg_locks` — true when the worker process holds the
 * Postgres advisory lock that gates the poller, reconciler and job sweeps.
 * `since` is when THIS process first observed the lock held (pg_locks does
 * not record acquisition time; treat it as best-effort, not exact).
 */
let firstSeenHeld: number | null = null;

export async function GET() {
  const writer = await writerLockHeld(db.prisma);
  if (writer && firstSeenHeld === null) firstSeenHeld = Date.now();
  if (!writer) firstSeenHeld = null;
  return NextResponse.json({
    ok: true,
    writer,
    since: writer && firstSeenHeld !== null ? new Date(firstSeenHeld).toISOString() : null,
  });
}
