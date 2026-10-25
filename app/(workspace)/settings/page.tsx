"use client";
import { XCircle } from "lucide-react";
import {
  CustomNodesSection, ExecutionSection, PricingSection, PromptTemplatesSection, StatusBar,
} from "@/components/settings/general";
import { useSettings } from "@/components/settings/context";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

export default function SettingsGeneralPage() {
  const { settings, loading, error, saveSettings } = useSettings();

  return (
    <div>
      <header className="mb-7">
        <h1 className="text-lg font-semibold tracking-tight m-0">General</h1>
        <p className="text-muted-foreground text-[13px] mt-1 mb-0">
          Execution defaults, model pricing, prompts and custom-node settings.
        </p>
      </header>

      {error && (
        <Alert variant="destructive" className="mb-5">
          <XCircle size={16} /><span className="flex-1">{error}</span>
        </Alert>
      )}

      {loading && <Spinner />}

      {settings && <StatusBar settings={settings} />}
      {settings && <ExecutionSection settings={settings} onSave={saveSettings} />}
      {settings && <PricingSection settings={settings} onSave={saveSettings} />}
      {settings?.prompt_templates && (
        <PromptTemplatesSection templates={settings.prompt_templates} onSave={saveSettings} />
      )}
      {settings && <CustomNodesSection settings={settings} onSave={saveSettings} />}
    </div>
  );
}
