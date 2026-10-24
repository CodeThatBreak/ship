import { NextResponse } from "next/server";
import { db } from "../../../../../lib/db";

export const dynamic = "force-dynamic";

/**
 * Normalized comment payload for the review panel (git-host-agnostic). The
 * legacy GitLab note JSON in `comments.raw` is parsed server-side — the UI
 * never sees host-shaped payloads.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const comments = db.all<any>(
    `SELECT * FROM comments WHERE flow_id=? ORDER BY created_at DESC`, id
  ).map((c) => {
    // `raw` may be the normalized HostComment JSON (new rows) or the legacy
    // GitLab note JSON (rows ingested before normalization) — read both
    let parsed: any = null;
    try { parsed = c.raw ? JSON.parse(c.raw) : null; } catch { parsed = null; }
    return {
      id: c.id as string,
      threadId: (c.discussion_id ?? null) as string | null,
      author: (c.author ?? null) as string | null,
      body: c.body as string,
      path: (parsed?.path ?? parsed?.position?.new_path ?? null) as string | null,
      line: (parsed?.line ?? parsed?.position?.new_line ?? null) as number | null,
      status: c.status as string,
      resolvable: typeof parsed?.resolvable === "boolean" ? parsed.resolvable : true,
      resolved: typeof parsed?.resolved === "boolean"
        ? parsed.resolved
        : c.status === "resolved",
      createdAt: (parsed?.createdAt ?? parsed?.created_at ?? c.created_at) as string,
    };
  });
  return NextResponse.json({ comments });
}
