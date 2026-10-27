"use client";
/**
 * The node configurator's tab state (§8): the active tab, the tab set for the
 * node (the start node shows only Trigger + Start fields; prompt-carrying
 * nodes get the dedicated Prompt tab) and the reset-per-node behavior.
 */
import { useEffect, useState } from "react";
import type { EditorNode, NodeContract } from "../types";
import { promptEditorKeys } from "../ConfigFieldRow";

/** Tab button labels (the start node shows only a subset of the tabs).
 *  D4: the start editor's tab is "Start fields" and the contract view is
 *  "Inputs & outputs" — one name per mental slot everywhere. */
export const TAB_LABELS: Record<string, string> = {
  trigger: "Trigger",
  inputs: "Inputs",
  prompt: "Prompt",
  config: "Config",
  contract: "Inputs & outputs",
  output: "Start fields",
};

/** The seeded Start catalog row id; the start contract is edited per instance. */
function isStartNode(node: EditorNode): boolean {
  return (
    node.nodeTemplateId === "nt_start" ||
    (node.is_builtin && (node.catalog_name ?? "").toLowerCase() === "start")
  );
}

export function useConfiguratorTabs({
  node,
  contract,
}: {
  node: EditorNode;
  /** the node's resolved contract (see `use-node-contract-view`) */
  contract: NodeContract | null;
}) {
  const [tab, setTab] = useState<
    "trigger" | "inputs" | "prompt" | "config" | "output" | "contract"
  >("trigger");

  // reset the selected tab per node: a render-time adjustment keyed on the
  // node's identity (two instances can share a nodeTemplateId — the tab keys
  // off the instance's config emptiness, not the node object reference)
  const [tabNodeIdentity, setTabNodeIdentity] = useState<string | null>(null);
  const nodeIdentity = node ? `${node.nodeTemplateId}:${node.key}` : null;
  if (node && nodeIdentity !== tabNodeIdentity) {
    setTabNodeIdentity(nodeIdentity);
    setTab(
      !isStartNode(node) && Object.keys(node.config ?? {}).length === 0
        ? "config"
        : "trigger",
    );
  }

  // a freshly placed node opens on the Prompt tab — the prompt is the work
  // for prompt-carrying kinds (the Config tab no longer holds it)
  useEffect(() => {
    if (!contract) return;
    const hasPrompt = (contract.config.fields ?? []).some((f) =>
      promptEditorKeys.has(f.key),
    );
    if (hasPrompt && node && Object.keys(node.config ?? {}).length === 0) {
      setTab("prompt");
    }
  }, [contract, node]);

  // the start node has no config and no input mapping — its fields flow
  // straight to the next nodes, so it gets Trigger + Output Schema only.
  // Prompt-carrying nodes get a dedicated Prompt tab (the full three-part
  // editor) — the prompt fields leave the Config tab for it.
  const hasPromptFields = (contract?.config?.fields ?? []).some((f) =>
    promptEditorKeys.has(f.key),
  );
  const start = node ? isStartNode(node) : false;
  const tabs = start
    ? (["trigger", "output"] as const)
    : hasPromptFields
      ? (["trigger", "inputs", "prompt", "config", "contract"] as const)
      : (["trigger", "inputs", "config", "contract"] as const);

  return { tab, setTab, tabs };
}
