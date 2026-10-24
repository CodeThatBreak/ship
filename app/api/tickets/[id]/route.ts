import { updateTask } from "../../tasks/handlers";

/**
 * DEPRECATED: moved to /api/tasks. Kept as a thin shim for external scripts —
 * dropped in the Phase 4 cleanup.
 */
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await updateTask(req, id);
  res.headers.set("Deprecation", "true");
  res.headers.set(
    "Warning",
    `299 - "endpoint moved to /api/tasks — /api/tickets will be dropped"`
  );
  return res;
}
