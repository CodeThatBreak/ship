import { toErrorResponse } from "@/lib/errors";
import { parseJson } from "@/lib/http/parse";
import { NextResponse } from "next/server";
import { z } from "zod";
import { flowEngine } from "../../../lib/engine/flow-engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CreateFlowBody = z
  .object({
    taskId: z.string().min(1),
    repoUrl: z.string().optional(),
    repoId: z.string().optional(),
    executionMode: z.enum(["cloud", "local"]).optional(),
    name: z.string().optional(),
    templateId: z.string().optional(),
  })
  .refine((body) => Boolean(body.repoUrl?.trim() || body.repoId?.trim()), {
    message: "repoUrl or repoId required",
  });

export const GET = async () => {
  return NextResponse.json({ flows: flowEngine.list() });
};

export const POST = async (req: Request) => {
  try {
    const body = await parseJson(req, CreateFlowBody);
    const id = flowEngine.create(body.taskId, body.repoUrl?.trim() ?? "", body.name, {
      executionMode: body.executionMode,
      repoId: body.repoId,
      templateId: body.templateId,
    });
    return NextResponse.json({ id });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};
