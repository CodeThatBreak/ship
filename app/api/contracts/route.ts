import { contractParamsSchema, contractService } from "@/lib/contracts";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = async (req: Request) => {
  const url = new URL(req.url);
  const defKey = url.searchParams.get("def") ?? "";
  const kindParam = url.searchParams.get("kind") ?? "";
  let instanceConfig: Record<string, unknown> | null = null;
  const rawConfig = url.searchParams.get("config");
  if (rawConfig) {
    try {
      const parsed: unknown = JSON.parse(rawConfig);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        instanceConfig = parsed as Record<string, unknown>;
      }
    } catch {
      instanceConfig = null;
    }
  }
  return contractService.resolve({
    def: defKey || undefined,
    kind: kindParam || undefined,
    name: url.searchParams.get("name") ?? undefined,
    config: instanceConfig,
  });
};

export const POST = async (req: Request) => {
  const body: unknown = await req.json().catch(() => null);
  const parsed = contractParamsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid contract request" }, { status: 400 });
  }
  return contractService.resolve(parsed.data);
};
