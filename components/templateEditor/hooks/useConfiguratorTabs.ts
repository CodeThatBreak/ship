"use client";
import { useState } from "react";
import type { EditorNode, NodeContract } from "../types";
import { promptEditorKeys } from '../components/configurator/fields/ConfigFieldRow';

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

/** What the initial-pick reset is keyed on: which node is configured and
 *  whether its contract has settled (pending/errored contracts render as
 *  `null`, so the pick initially runs without the prompt fields). The node
 *  object and the contract view are rebuilt on every field patch, so keying
 *  a reset on them re-picked the initial tab per keystroke — the drawer
 *  jumped back to the first tab whenever any value changed. */
const pickSignature = (node: EditorNode, contract: NodeContract | null): string =>
  `${node.key}:${contract === null ? "pending" : "resolved"}`;

export const useConfiguratorTabs = ({
  node,
  contract,
}: {
  node: EditorNode;
  contract: NodeContract | null;
}) => {
  const [settledSignature, setSettledSignature] = useState(() =>
    pickSignature(node, contract),
  );
  const [tab, setTab] = useState(() => pickInitialTab(node, contract));

  // re-pick ONLY when a different node opens, or once its contract first
  // settles (the pick needs the contract's prompt fields). Adjusted during
  // render (the documented derive-state pattern) so the reset can't fire on
  // every field patch, where `node`/`contract` are rebuilt each time.
  const signature = pickSignature(node, contract);
  if (signature !== settledSignature) {
    setSettledSignature(signature);
    setTab(pickInitialTab(node, contract));
  }

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
