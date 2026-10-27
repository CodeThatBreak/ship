"use client";
/**
 * Registers React Flow's screen→flow helper and fitView with the page
 * (hooks → a plain callback; see builder-flow's palette placement).
 * A renderless component: hooks, zero markup.
 */
import { useEffect } from "react";
import { useReactFlow } from "@xyflow/react";
import type { BuilderApi } from "./BuilderFlow";

/** Exposes useReactFlow helpers to the page (sits inside the provider). */
export function ApiBridge({ onApi }: { onApi: (api: BuilderApi) => void }) {
  const { screenToFlowPosition, fitView } = useReactFlow();
  useEffect(() => {
    onApi({ screenToFlowPosition, fitView });
    // onApi is deliberately excluded: the page's handler is an inline lambda
    // over a ref, and re-running on every render churns the registration
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenToFlowPosition, fitView]);
  return null;
}
