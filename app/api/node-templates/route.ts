import { NextResponse } from "next/server";
import { templateStore } from "../../../lib/engine/templates";

export const dynamic = "force-dynamic";

/** The node-type catalog (built-ins + declarative), for the configurator palette. */
export async function GET() {
  const nodeTemplates = templateStore.listNodeTemplates().map((nt) => ({
    id: nt.id,
    key: nt.key,
    name: nt.name,
    kind: nt.kind,
    version: nt.version,
    description: nt.description,
    icon: nt.icon,
    is_builtin: Boolean(nt.is_builtin),
    config: nt.config,
  }));
  return NextResponse.json({ nodeTemplates });
}

/** Create a declarative node template (Phase 2: kind=agent). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as null | {
    key?: string; name?: string; kind?: string; icon?: string | null;
    description?: string | null; config?: Record<string, unknown>;
  };
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  try {
    const nt = templateStore.createNodeTemplate({
      key: body.key,
      name: body.name ?? "",
      kind: body.kind ?? "agent",
      icon: body.icon ?? null,
      description: body.description ?? null,
      config: body.config ?? {},
    });
    return NextResponse.json({ nodeTemplate: { ...nt, is_builtin: Boolean(nt.is_builtin) } });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
