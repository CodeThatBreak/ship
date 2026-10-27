"use client";
import { XCircle } from "lucide-react";
import { useSettings } from "@/components/settings/context";
import { ReposSection } from "@/components/settings/repos";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

/** Loading placeholder mirroring the section header + repo-card rows. */
function RepositoriesSkeleton() {
  return (
    <div aria-hidden>
      <div className="flex items-center justify-between gap-3 mb-3">
        <Skeleton className="h-5 w-32 rounded-lg" />
        <Skeleton className="h-8 w-[104px] rounded-lg" />
      </div>
      <div className="grid gap-2.5">
        <Skeleton className="h-[62px] w-full rounded-lg" />
        <Skeleton className="h-[62px] w-full rounded-lg" />
        <Skeleton className="h-[62px] w-2/3 rounded-lg" />
      </div>
    </div>
  );
}

/**
 * Settings → Repositories: the repo registry — cloud URLs, local checkouts
 * and worktree setup policies — mirroring the integrations page pattern.
 */
export default function SettingsRepositoriesPage() {
  const { repos, loading, error, setError } = useSettings();

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

      {loading ? <RepositoriesSkeleton /> : <ReposSection repos={repos} onError={setError} />}
    </div>
  );
}
