"use client";
import { XCircle } from "lucide-react";
import { useSettings } from "@/components/settings/context";
import { ReposSection } from "@/components/settings/repos";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

export default function SettingsRepositoriesPage() {
  const { repos, loading, error, setError, reload } = useSettings();

  return (
    <div>
      <header className="mb-7">
        <h1 className="text-lg font-semibold tracking-tight m-0">Repositories</h1>
        <p className="text-muted-foreground text-[13px] mt-1 mb-0">
          The repos flows run against — cloud URLs, local paths and worktree setup policies.
        </p>
      </header>

      {error && (
        <Alert variant="destructive" className="mb-5">
          <XCircle size={16} /><span className="flex-1">{error}</span>
        </Alert>
      )}

      {loading ? <Spinner /> : (
        <ReposSection repos={repos} onChanged={() => void reload()} onError={setError} />
      )}
    </div>
  );
}
