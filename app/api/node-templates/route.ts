import { toErrorResponse } from "@/lib/errors";
import { parseJson } from "@/lib/http/parse";
import { nodeTemplateCreateBodySchema } from "@/lib/schemas/node-template";
import { NextResponse } from "next/server";
import { templateStore } from "../../../lib/engine/templates/template-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The node-type catalog (built-ins + declarative), for the builder palette. */
export const GET = async (req: Request) => {
  const templateId = new URL(req.url).searchParams.get("templateId") ?? undefined;
  const payload = templateStore.paletteCatalog(templateId);
  return NextResponse.json(payload);
};

/** Create a declarative node template (Phase 2: kind=agent). */
export const POST = async (req: Request) => {
  try {
    const body = await parseJson(req, nodeTemplateCreateBodySchema);
    const nt = templateStore.createNodeTemplateFromRequest(body);
    return NextResponse.json({ nodeTemplate: templateStore.toNodeCatalogRow(nt) });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};
