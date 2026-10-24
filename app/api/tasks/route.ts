import { listTasks, syncTasks } from "./handlers";

export const dynamic = "force-dynamic";

export async function GET() {
  return listTasks();
}

/** Sync tasks from a provider (body {kind}, default: the first provider). */
export async function POST(req: Request) {
  return syncTasks(req);
}
