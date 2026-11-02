"use client";
import { useCallback } from "react";
import { Cpu } from "lucide-react";
import type { Settings } from "../../context";
import { Card } from "@/components/ui/card";
import { useDefaultMode } from "../hooks/useDefaultMode";
import { useDefaultModel } from "../hooks/useDefaultModel";
import { DefaultModelFields } from "./DefaultModelFields";
import { ModeCascade } from "./ModeCascade";
import { SectionHeading } from "./SectionHeading";

/**
 * Settings → Agent execution: the harness → mode cascade and the default
 * model. Local-agent options moved to Integrations → Harness.
 */
export function ExecutionSection({ settings, onError }: {
  settings: Settings;
  onError: (e: string | null) => void;
}) {
  const mode = useDefaultMode(settings);
  const model = useDefaultModel(settings);
  const { saveHarness: saveModeHook, saveMode: saveModeValue } = mode;
  const { save: saveModelHook } = model;
  const isModePending = mode.isPending;

  // stable bridge from the cascade's callbacks onto the page error alert
  const saveHarness = useCallback(
    (key: string) => {
      saveModeHook(key, {
        onSuccess: () => onError(null),
        onError: (e) => onError(e.message),
      });
    },
    [saveModeHook, onError],
  );
  const saveMode = useCallback(
    (key: string, value: string) => {
      saveModeValue(key, value, {
        onSuccess: () => onError(null),
        onError: (e) => onError(e.message),
      });
    },
    [saveModeValue, onError],
  );
  const saveModel = useCallback(
    (value: string | null) => {
      saveModelHook(value, {
        onSuccess: () => onError(null),
        onError: (e) => onError(e.message),
      });
    },
    [saveModelHook, onError],
  );

  return (
    <section className="mb-8">
      <SectionHeading icon={<Cpu size={14} />}>Agent execution</SectionHeading>
      <Card className="p-4 grid gap-4">
        <ModeCascade
          harnesses={mode.harnesses}
          selectedKey={settings.default_harness || null}
          savedMode={settings.default_execution_mode}
          saving={isModePending}
          onSaveHarness={saveHarness}
          onSaveMode={saveMode}
        />
        <div className="border-t border-border pt-4">
          <DefaultModelFields
            options={model.options}
            stored={model.stored}
            source={model.source}
            saving={model.isPending}
            onSave={saveModel}
          />
        </div>
      </Card>
    </section>
  );
}
