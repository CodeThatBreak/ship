import { toErrorResponse } from "@/lib/errors";
import { NextResponse } from "next/server";
import { templateStore } from "../../../../lib/engine/templates/templateStore";
import { importTemplateYaml } from "../../../../lib/engine/templates/templateYaml";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Import a flow template from YAML (the `name/nodes/edges` §7 shape).
 * `POST { yaml: "..." }` — see scripts/import-template.mjs.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { yaml?: string; namePrefix?: string } | null;
  const text = typeof body?.yaml === "string" ? body.yaml : null;
  if (!text) return NextResponse.json({ error: "yaml text required" }, { status: 400 });
  try {
    const created = importTemplateYaml(templateStore, text, { namePrefix: body?.namePrefix });
    return NextResponse.json(created);
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
}
