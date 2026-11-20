import "server-only";

import { TaskService } from "./taskService/taskService";
import { db } from "@/lib/db/app";
import { taskRegistry } from "./registry";

/**
 * Shared task service pin (stateless, db-injected — decision Q9). The
 * TaskService class lives in `taskService/`; this module keeps the pin so
 * the import surface (`taskService`) is unchanged. Class files are pure
 * (classFilePurity arch test), so the instance is pinned here.
 */
export const taskService = new TaskService(db, taskRegistry);
