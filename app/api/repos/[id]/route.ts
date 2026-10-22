import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { db } from "../../../../lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = db.repoById(id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json();
  let localPath = body.local_path !== undefined ? body.local_path : existing.local_path;
  if (localPath && localPath.startsWith("~")) {
    localPath = path.join(process.env.HOME ?? "", localPath.slice(1));
  }
  if (localPath && !fs.existsSync(path.join(localPath, ".git"))) {
    return NextResponse.json(
      { error: `Local path is not a git repository: ${localPath}` },
      { status: 400 }
    );
  }
  const repo = db.upsertRepo({
    id,
    name: body.name ?? existing.name,
    cloud_url: body.cloud_url ?? existing.cloud_url,
    local_path: localPath || null,
    default_branch: body.default_branch ?? existing.default_branch,
  });
  return NextResponse.json({ repo });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  db.deleteRepo(id);
  return NextResponse.json({ ok: true });
}
