import { toErrorResponse } from "@/lib/errors";
import { templateStore } from "../../../../../lib/engine/templates/templateStore";
import { gatherTemplateYaml } from "../../../../../lib/engine/templates/templateYaml";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Export the template as YAML (config-as-code, §7 shape). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    // draft instances (Phase 2) have no catalog row yet — exporting would
    // reference node templates that don't exist
    if (templateStore.hasDraftNodes(id)) {
      return Response.json(
        { error: "Save before exporting — this template has custom nodes that aren't saved yet." },
        { status: 409 },
      );
    }
    const yaml = gatherTemplateYaml(templateStore, id);
    const name = templateStore.flowTemplate(id)?.name ?? "template";
    return new Response(yaml, {
      status: 200,
      headers: {
        "Content-Type": "text/yaml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase()}.yaml"`,
      },
    });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
}
