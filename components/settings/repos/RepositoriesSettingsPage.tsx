"use client";
import { RefreshCw, XCircle } from "lucide-react";
import { ReposSection } from "./ReposSection";
import { useSettingsPageError } from "../hooks/use-settings-page-error";
import { useReposQuery } from "../hooks/use-repos-query";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const RepositoriesSkeleton = () => (
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

/** Settings → Repositories client island. */
export const RepositoriesSettingsPage = () => {
  const { repos, serverHome, isPending, isError, errorMessage, refetch } = useReposQuery();
  const { actionError, reportError, clearError } = useSettingsPageError();

  const bannerError = actionError ?? errorMessage;

  const onError = (message: string | null) => {
    if (message === null) {
      clearError();
      return;
    }
    reportError(message);
  };

  return (
    <div>
      <header className="mb-7">
        <h1 className="text-lg font-semibold tracking-tight m-0">Repositories</h1>
        <p className="text-muted-foreground text-[13px] mt-1 mb-0">
          The repos flows run against — cloud URLs, local paths and worktree setup policies.
        </p>
      </header>

      {bannerError && (
        <Alert variant="destructive" className="mb-5 flex items-center gap-2">
          <XCircle size={16} />
          <span className="flex-1">{bannerError}</span>
          {isError && (
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw size={12} /> Retry
            </Button>
          )}
        </Alert>
      )}

      {isPending ? (
        <RepositoriesSkeleton />
      ) : isError ? null : (
        <ReposSection repos={repos} serverHome={serverHome} onError={onError} />
      )}
    </div>
  );
};
