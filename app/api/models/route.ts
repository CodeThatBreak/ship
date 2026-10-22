import { NextResponse } from "next/server";
import { LocalAgentService, localAgent } from "../../../lib/integrations/localAgent";
import { db } from "../../../lib/db";
import { config } from "../../../lib/config";

export const dynamic = "force-dynamic";

/** Models available for agent runs — from the account model catalog, with a static fallback. */
export async function GET() {
  const catalogModels = await localAgent.listModels();
  const models = catalogModels ?? [...LocalAgentService.FALLBACK_MODELS];
  const currentDefault = db.getSetting<string>("default_model", "") || config.cursor.defaultModel() || "";
  // Make sure the configured default is always selectable even if the catalog
  // doesn't list it (e.g. an alias or a newly released model).
  if (currentDefault && !models.includes(currentDefault)) models.unshift(currentDefault);
  return NextResponse.json({
    models,
    source: catalogModels ? "catalog" : "fallback",
    default: currentDefault || null,
  });
}
