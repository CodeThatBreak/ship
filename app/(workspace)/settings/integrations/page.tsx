"use client";
import { XCircle } from "lucide-react";
import { useSettings } from "@/components/settings/context";
import { GitHostsSection } from "@/components/settings/host-instances";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

export default function SettingsIntegrationsPage() {
  const { hosts, loading, error, setError, reload } = useSettings();

  return (
    <div>
      <header className="mb-7">
        <h1 className="text-lg font-semibold tracking-tight m-0">Integrations</h1>
        <p className="text-muted-foreground text-[13px] mt-1 mb-0">
          Self-hosted git-host instances — tokens are matched to repos by domain.
        </p>
      </header>

      {error && (
        <Alert variant="destructive" className="mb-5">
          <XCircle size={16} /><span className="flex-1">{error}</span>
        </Alert>
      )}

      {loading ? <Spinner /> : hosts.map((h) => (
        <GitHostsSection key={h.kind} host={h} onChanged={() => void reload()} onError={setError} />
      ))}
    </div>
  );
}
