import { INSTANCE_SURFACE, type InstanceSurface } from "../constants";
import { queryKeys } from "@/constants/query-keys";

/** Query keys to refresh integration status flags after connect/remove (CR-151). */
export const integrationStatusInvalidations = (
  surface: InstanceSurface,
): readonly (readonly string[])[] => {
  if (surface === INSTANCE_SURFACE.HOST) {
    return [queryKeys.settings, queryKeys.gitHosts];
  }
  return [queryKeys.settings, queryKeys.taskProviders];
};
