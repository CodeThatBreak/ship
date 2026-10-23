import { NextResponse } from "next/server";
import { templateStore } from "../../../lib/engine/templates";

export const dynamic = "force-dynamic";

/** The template gallery. */
export async function GET() {
  return NextResponse.json({ templates: templateStore.list() });
}

/** Create a blank template (nodes/edges are shaped in the editor). */
export async function POST(req: Request) {
  const { name, description } = await req.json().catch(() => ({}) as never);
  try {
    const id = templateStore.create({
      name: typeof name === "string" && name.trim() ? name : undefined,
      description: typeof description === "string" ? description : null,
      nodes: [],
      edges: [],
    });
    return NextResponse.json({ id });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
