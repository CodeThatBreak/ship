import "server-only";

import { db } from "@/lib/db";
import { processSingleton } from "@/lib/singleton";
import { taskRegistry } from "./registry";
import { LiveTaskFeed } from "./live-task-feed";
import { TaskService } from "./task-service";

export const liveTaskFeed = processSingleton(
  "liveTaskFeed",
  () => new LiveTaskFeed(taskRegistry),
);

export const taskService = processSingleton("taskService", () => new TaskService(db, taskRegistry));

export { LiveTaskFeed } from "./live-task-feed";
export { TaskService } from "./task-service";
