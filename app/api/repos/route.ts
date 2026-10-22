import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { db } from "../../../lib/db";

export const dynamic = "force-dynamic";

function validateLocalPath(p: string | null | undefined): string | null {
  if (!p) return null;
  const expanded = p.startsWith("~")
    ? path.join(process.env.HOME ?? "", p.slice(1))
    : p;
  return expanded;
}

export async function GET() {
  const repos = db.listRepos().map((r) => ({
    ...r,
    local_path_exists: r.local_path ? fs.existsSync(path.join(r.local_path, ".git")) : false,
  }));
  return NextResponse.json({ repos });
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.name || !body.cloud_url) {
    return NextResponse.json({ error: "name and cloud_url are required" }, { status: 400 });
  }
  const localPath = validateLocalPath(body.local_path);
  if (localPath && !fs.existsSync(path.join(localPath, ".git"))) {
    return NextResponse.json(
      { error: `Local path is not a git repository: ${localPath}` },
      { status: 400 }
    );
  }
  const repo = db.upsertRepo({
    name: body.name,
    cloud_url: body.cloud_url,
    local_path: localPath,
    default_branch: body.default_branch || "main",
  });
  return NextResponse.json({ repo });
}
