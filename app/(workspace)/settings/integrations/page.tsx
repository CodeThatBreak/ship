import { IntegrationsSettingsPage } from "@/components/settings/integrations/IntegrationsSettingsPage";

export const dynamic = "force-dynamic";

/** Settings → Integrations — client island; instance lists load per tab. */
export default function SettingsIntegrationsPage() {
  return <IntegrationsSettingsPage />;
}
