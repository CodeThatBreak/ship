"use client";
import { useEffect, useState } from "react";
import type { EditorNode, NodeContract } from "../types";
import { promptEditorKeys } from "../ConfigFieldRow";

export const TAB_LABELS: Record<string, string> = {
  trigger: "Trigger",
  inputs: "Inputs",
  prompt: "Prompt",
  config: "Config",
  contract: "Inputs & outputs",
  output: "Start fields",
};

import { BUILTIN_TEMPLATE_ID, CATALOG_KEY } from "@/constants/nodeKind";

const isStartNode = (node: EditorNode): boolean =>
  node.nodeTemplateId === BUILTIN_TEMPLATE_ID.START ||
  (node.is_builtin && (node.catalog_name ?? "").toLowerCase() === CATALOG_KEY.START);

const pickInitialTab = (
  node: EditorNode,
  contract: NodeContract | null,
): "trigger" | "inputs" | "prompt" | "config" | "output" | "contract" => {
  if (isStartNode(node)) return "trigger";
  const emptyConfig = Object.keys(node.config ?? {}).length === 0;
  const hasPrompt = (contract?.config?.fields ?? []).some((f) =>
    promptEditorKeys.has(f.key),
  );
  if (emptyConfig && hasPrompt) return "prompt";
  if (emptyConfig) return "config";
  return "trigger";
};

export const useConfiguratorTabs = ({
  node,
  contract,
}: {
  node: EditorNode;
  contract: NodeContract | null;
}) => {
  const [tab, setTab] = useState(() => pickInitialTab(node, contract));

  useEffect(() => {
    setTab(pickInitialTab(node, contract));
  }, [node, contract]);

  const hasPromptFields = (contract?.config?.fields ?? []).some((f) =>
    promptEditorKeys.has(f.key),
  );
  const start = isStartNode(node);
  const tabs = start
    ? (["trigger", "output"] as const)
    : hasPromptFields
      ? (["trigger", "inputs", "prompt", "config", "contract"] as const)
      : (["trigger", "inputs", "config", "contract"] as const);

  return { tab, setTab, tabs };
};
