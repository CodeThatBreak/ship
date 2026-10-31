"use client";
import { useMutation } from "@tanstack/react-query";
import {
  executeStartBuild,
  type StartBuildArgs,
} from "../utils/execute-start-build";

export type { StartBuildArgs };

/**
 * The build-start chain, as one mutation: materialize the live task into the
 * DB (write-through — only the picked task lands there; the engine needs the
 * row for FK + context hydration while browsing stays live-only), pin the
 * repo URL, then create the flow. Resolves with the new flow id; any step's
 * `error` contract surfaces as a thrown Error for the caller to render.
 */
export const useStartBuild = (handleStarted: (flowId: string) => void) => {
  return useMutation({
    mutationFn: executeStartBuild,
    onSuccess: handleStarted,
  });
};
