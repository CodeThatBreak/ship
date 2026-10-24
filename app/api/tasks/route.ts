import { listTasks, syncTasks } from "./handlers";

export const dynamic = "force-dynamic";

export async function GET() {
  return listTasks();
}

/** Sync tasks from Jira into the local DB. */
export async function POST() {
  return syncTasks();
}
