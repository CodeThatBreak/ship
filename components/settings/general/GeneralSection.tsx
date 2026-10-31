"use client";
import type { Settings } from "@/types/settings";
import { CustomNodesSection } from "./components/CustomNodesSection";
import { ExecutionSection } from "./components/ExecutionSection";
import { StatusBar } from "./components/StatusBar";

/**
 * Settings → General: status strip, agent-execution defaults (harness → mode
 * cascade + default model) and the custom-node section (write-only secrets +
 * the SSRF HTTP allowlist). Loading/error/empty states are handled by the
 * page; this renders only with live settings.
 */
export function GeneralSection({ settings, onError }: {
  settings: Settings;
  onError: (e: string | null) => void;
}) {
  return (
    <>
      <StatusBar settings={settings} />
      <ExecutionSection settings={settings} onError={onError} />
      <CustomNodesSection settings={settings} onError={onError} />
    </>
  );
}
