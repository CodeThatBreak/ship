import { NextResponse } from "next/server";
import { gitHostRegistry } from "../../../lib/engine/ports/gitHost";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Registered git hosts (metadata for the settings UI): kinds, labels,
 * configured status, and their instances (tokens masked).
 */
export async function GET() {
  const hosts = gitHostRegistry.list().map((h) => ({
    kind: h.kind,
    label: h.label,
    configured: h.configured(),
    instances: h.instances(),
  }));
  return NextResponse.json({ hosts });
}
