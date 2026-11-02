import "server-only";

import { type SettingSource } from '../../../../templates/nodeConfig';

/** What a plan-mode agent run (initial or retry) needs beyond its prompt. */
interface PlanRunArgs {
  label: string;
  model: string | null;
  settingSources: SettingSource[];
}

export type { PlanRunArgs };

export type { LatestPlan, ScopedRefine } from './scopedRefine';
