import { NextResponse } from "next/server";
import { db } from "../../../../../lib/db";
import { type HostComment } from "../../../../../lib/engine/ports/git-host";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** One comment row as the route reads it from the DB. */
interface CommentRow {
  id: string;
  discussion_id: string | null;
  author: string | null;
  body: string;
  status: string;
  /** the normalized HostComment JSON (legacy git-host note JSON is rewritten
   *  into that shape by the DB migration) */
  raw: string | null;
  created_at: string;
}

/** Normalized comment payload for the review panel (git-host-agnostic). */
interface ApiComment {
  id: string;
  threadId: string | null;
  author: string | null;
  body: string;
  path: string | null;
  line: number | null;
  status: string;
  resolvable: boolean;
  resolved: boolean;
  createdAt: string;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const comments = db
    .all<CommentRow>(`SELECT * FROM comments WHERE flow_id=? ORDER BY created_at DESC`, id)
    .map((c): ApiComment => {
      // `raw` = the normalized HostComment JSON every ingest writes
      let parsed: Partial<HostComment> = {};
      try { parsed = c.raw ? (JSON.parse(c.raw) as Partial<HostComment>) : {}; } catch { parsed = {}; }
      return {
        id: c.id,
        threadId: c.discussion_id,
        author: c.author,
        body: c.body,
        path: parsed.path ?? null,
        line: parsed.line ?? null,
        status: c.status,
        resolvable: typeof parsed.resolvable === "boolean" ? parsed.resolvable : true,
        resolved: typeof parsed.resolved === "boolean" ? parsed.resolved : c.status === "resolved",
        createdAt: parsed.createdAt ?? c.created_at,
      };
    });
  return NextResponse.json({ comments });
}
