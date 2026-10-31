import { NextResponse } from "next/server";
import { z } from "zod";
import { templateStore } from "../../../lib/engine/templates/template-store";
import { toErrorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const createTemplateBody = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
});

/** The template gallery. */
export async function GET() {
  return NextResponse.json({ templates: templateStore.list() });
}

/** Create a blank template — every template starts with a Start node (the flow
 *  entry: it carries the branch trigger and finishes immediately); nodes and
 *  edges are shaped in the editor. */
export async function POST(req: Request) {
  const raw: unknown = await req.json().catch(() => null);
  const parsed = createTemplateBody.safeParse(raw ?? {});
  const body = parsed.success ? parsed.data : {};
  try {
    const id = templateStore.create({
      name: typeof body.name === "string" && body.name.trim() ? body.name : undefined,
      description: typeof body.description === "string" ? body.description : null,
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
    return toErrorResponse(e);
  }
}
