import { toErrorResponse } from "@/lib/errors";
import { parseJson } from "@/lib/http/parse";
import { db } from "@/lib/db";
import { taskService } from "@/lib/engine/tasks";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TaskPatchBody = z.object({
  repoUrl: z.string().optional(),
});

export const PATCH = async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const body = await parseJson(req, TaskPatchBody);
    if (body.repoUrl !== undefined) {
      return NextResponse.json(taskService.updateRepoUrl(id, body.repoUrl));
    }
    return NextResponse.json({ ok: true, updated_at: db.now() });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};
