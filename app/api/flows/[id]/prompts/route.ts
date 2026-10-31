import { NextResponse } from "next/server";
import { promptPreview } from "../../../../../lib/engine/prompts/prompt-preview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The plan composer's bulk prompt read (thin, per AGENTS 3.2): one response
 * carries every promptable node's editable body keyed by node key — no
 * per-node resolution beyond what the PromptPreview service owns.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await promptPreview.allFor(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ prompts: result.prompts });
}
