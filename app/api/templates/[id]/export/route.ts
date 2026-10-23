import { templateStore } from "../../../../../lib/engine/templates";
import { gatherTemplateYaml } from "../../../../../lib/engine/templates-yaml";

export const dynamic = "force-dynamic";

/** Export the template as YAML (config-as-code, §7 shape). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
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
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }
}
