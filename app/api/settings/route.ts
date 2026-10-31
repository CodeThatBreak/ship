import { toErrorResponse } from "@/lib/errors";
import { parseJson } from "@/lib/http/parse";
import { settingsPatchBodySchema } from "@/lib/schemas/settings-patch";
import { settingsService } from "@/lib/settings";
import { loadSettings } from "@/loaders/settings";
import { NextResponse } from "next/server";
import { agentPortRegistry } from "../../../lib/engine/ports/agent-port";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The distinct harness surfaces the registered ports belong to. */
const registeredHarnesses = (): string[] =>
  [...new Set(agentPortRegistry.list().map((p) => p.harness))];

export const GET = async () => {
  return NextResponse.json(await loadSettings());
};

export const PATCH = async (req: Request) => {
  try {
    const body = await parseJson(req, settingsPatchBodySchema(registeredHarnesses()));
    settingsService.update(body);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};
