import { NextResponse } from "next/server";
import { templateStore } from "../../../../lib/engine/templates";
import { invalidateDeclarativeDef } from "../../../../lib/engine/nodes/declarative";

export const dynamic = "force-dynamic";

/** PATCH body flag marking a promotion (a meta patch carries it unset). */
const ADD_TO_LIBRARY = "add_to_library";

/** Update a declarative node template (shared definition), or — with
 *  `{ add_to_library: true }` — promote a template-local row to the global
 *  Library (every template's builder then lists it). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null) as null | {
    add_to_library?: boolean;
    name?: string; description?: string | null; icon?: string | null; config?: Record<string, unknown>;
  };
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  try {
    if (body[ADD_TO_LIBRARY] === true) {
      const nt = templateStore.addToLibrary(id);
      invalidateDeclarativeDef(id); // running flows snapshot config — only cached defs refresh
      return NextResponse.json({ nodeTemplate: { ...nt, is_builtin: Boolean(nt.is_builtin) } });
    }
    const nt = templateStore.updateNodeTemplate(id, body);
    invalidateDeclarativeDef(id); // running flows snapshot config — only cached defs refresh
    return NextResponse.json({ nodeTemplate: { ...nt, is_builtin: Boolean(nt.is_builtin) } });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    templateStore.deleteNodeTemplate(id);
    invalidateDeclarativeDef(id);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
