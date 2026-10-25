"use client";
import { useCallback } from "react";
import { Cpu } from "lucide-react";
import type { Settings } from "../../context";
import { Card } from "@/components/ui/card";
import { useDefaultMode } from "../hooks/use-default-mode";
import { useDefaultModel } from "../hooks/use-default-model";
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

  // stable bridge from the cascade's callbacks onto the page error alert
  const saveHarness = useCallback(
    (key: string) => {
      mode.saveHarness(key, { onError: (e) => onError(e.message) });
    },
    [mode.saveHarness, onError],
  );
  const saveMode = useCallback(
    (key: string, value: string) => {
      mode.saveMode(key, value, { onError: (e) => onError(e.message) });
    },
    [mode.saveMode, onError],
  );
  const saveModel = useCallback(
    (value: string | null) => {
      model.save(value, { onError: (e) => onError(e.message) });
    },
    [model.save, onError],
  );

  return (
    <section className="mb-8">
      <SectionHeading icon={<Cpu size={14} />}>Agent execution</SectionHeading>
      <Card className="p-4 grid gap-4">
        <ModeCascade
          harnesses={mode.harnesses}
          selectedKey={settings.default_harness || null}
          savedMode={settings.default_execution_mode}
          saving={mode.isPending}
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
