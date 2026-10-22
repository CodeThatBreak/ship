import { NextResponse } from "next/server";
import { nodeRegistry } from "../../../lib/engine/nodes/registry";

export const dynamic = "force-dynamic";

/** The workflow graph definition — derived from the node registry. */
export async function GET() {
  return NextResponse.json({
    order: nodeRegistry.order(),
    meta: nodeRegistry.meta(),
    edges: nodeRegistry.edges(),
  });
}
