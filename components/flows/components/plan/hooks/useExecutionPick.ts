import { useState } from "react";
import type { ExecutionMode } from "../constants";

/**
 * The approve footer's whole/steps pick. A refine re-publishes the resolution
 * and the pick follows the new published value whenever the selected plan
 * version or its published resolution changes — adjusted during render (§2.6),
 * so no effect is needed.
 */
export function useExecutionPick(
  resolution: ExecutionMode,
  /** change key: the selected plan version id + its published resolution */
  changeKey: string,
): [ExecutionMode, (mode: ExecutionMode) => void] {
  const [pick, setPick] = useState<ExecutionMode>(resolution);
  const [prevKey, setPrevKey] = useState<string | null>(null);
  if (prevKey !== null && changeKey !== prevKey) {
    setPrevKey(changeKey);
    setPick(resolution);
  } else if (prevKey === null) {
    setPrevKey(changeKey);
  }
  return [pick, setPick];
}
