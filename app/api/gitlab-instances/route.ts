import { NextResponse } from "next/server";
import { gitLab } from "../../../lib/integrations/gitlab";

export const dynamic = "force-dynamic";

export async function GET() {
  // don't leak full tokens to the client — mask them
  const instances = gitLab.listInstances().map((i) => ({
    ...i,
    token: maskToken(i.token),
    token_set: Boolean(i.token),
  }));
  return NextResponse.json({ instances, gitlabConfigured: gitLab.configured() });
}

function maskToken(t: string): string {
  if (!t) return "";
  if (t.length <= 4) return "••••";
  return `••••${t.slice(-4)}`;
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.base_url || !body.token) {
    return NextResponse.json({ error: "base_url and token are required" }, { status: 400 });
  }
  const inst = gitLab.addInstance({ name: body.name, base_url: body.base_url, token: body.token });
  return NextResponse.json({ instance: { ...inst, token: maskToken(inst.token), token_set: true } });
}
