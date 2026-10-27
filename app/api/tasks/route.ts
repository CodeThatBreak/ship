import { listTasks } from "./handlers";

export const dynamic = "force-dynamic";

export async function GET() {
  return listTasks();
}
