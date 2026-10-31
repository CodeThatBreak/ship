import { NextResponse } from "next/server";

import { hookStore } from "@/lib/engine/runtime/hook-store";
import { localApiRequestAuthorized } from "@/lib/local-api/authorize-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Reveal an inbound hook secret for the cockpit curl example (CR-254). */
export const GET = async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  if (!localApiRequestAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const hook = hookStore.hook(id);
  if (!hook) return NextResponse.json({ error: "unknown hook" }, { status: 404 });
  return NextResponse.json({ secret: hook.secret });
};
