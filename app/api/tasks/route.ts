import { listTasks } from "./handlers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return listTasks();
}
