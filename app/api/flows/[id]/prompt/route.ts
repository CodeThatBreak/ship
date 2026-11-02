import { NextResponse } from "next/server";
import { promptPreview } from "../../../../../lib/engine/prompts/promptPreview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The prompt modal's read endpoint (thin, per AGENTS 3.2): all resolution
 * lives in the PromptPreview service. The response carries the CURRENT live
 * resolution (def-resolved template + config knobs) and the LAST-RUN overlay
 * (nodes.input.prompt) with a `diverges` flag — no stale per-run override
 * vetoes the preview.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await promptPreview.previewFor(id, new URL(req.url));
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.payload);
}
