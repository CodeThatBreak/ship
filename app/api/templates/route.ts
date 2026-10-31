import { NextResponse } from "next/server";
import { templateStore } from "../../../lib/engine/templates/template-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The template gallery. */
export async function GET() {
  return NextResponse.json({ templates: templateStore.list() });
}

/** Create a blank template — every template starts with a Start node (the flow
 *  entry: it carries the branch trigger and finishes immediately); nodes and
 *  edges are shaped in the editor. */
export async function POST(req: Request) {
  const { name, description } = await req.json().catch(() => ({}) as never);
  try {
    const id = templateStore.create({
      name: typeof name === "string" && name.trim() ? name : undefined,
      description: typeof description === "string" ? description : null,
      nodes: [{
        key: "start",
        nodeTemplateId: "nt_start",
        trigger: { type: "auto" },
        join_mode: "all",
        config: {},
        input_map: {},
      }],
      edges: [],
    });
    return NextResponse.json({ id });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
