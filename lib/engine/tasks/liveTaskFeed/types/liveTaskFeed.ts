import type { LiveTask } from "../../types/taskProvider";

export type LiveTaskFeedMeta = {
  configured: boolean;
  provider: string;
  label: string;
  cached: boolean;
  stale?: boolean;
  ageSeconds: number;
  ttlSeconds: number;
  error?: string;
};

export type LiveTaskFeedResult =
  | { ok: true; tasks: LiveTask[]; meta: LiveTaskFeedMeta }
  | { ok: false; status: number; error: string };
