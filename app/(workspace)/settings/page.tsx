"use client";
import { XCircle } from "lucide-react";
import { useSettings } from "@/components/settings";
import { GeneralSection } from "@/components/settings/general";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

/** Loading placeholder mirroring the final layout: status strip, the
 *  execution card (cascade rows + model select) and the custom-node card
 *  (secret rows + allowlist textarea). */
function GeneralSkeleton() {
  return (
    <div aria-hidden>
      <Skeleton className="h-[44px] w-full rounded-lg mb-8" />

      <Skeleton className="h-4 w-36 rounded-lg mb-3" />
      <div className="grid gap-4 rounded-lg bg-card p-4 ring-1 ring-foreground/5 mb-8">
        <div className="grid gap-2.5">
          <Skeleton className="h-3.5 w-64" />
          <Skeleton className="h-8 w-[280px] rounded-lg" />
          <Skeleton className="h-7 w-[270px] rounded-lg" />
          <Skeleton className="h-3 w-3/4" />
        </div>
        <div className="grid gap-2.5 border-t border-border pt-4">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-8 max-w-[280px] w-full rounded-lg" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>

      <Skeleton className="h-4 w-32 rounded-lg mb-3" />
      <div className="grid gap-4 rounded-lg bg-card p-4 ring-1 ring-foreground/5">
        <div className="grid gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-7 w-[112px] rounded-lg" />
          </div>
          <Skeleton className="h-[62px] w-full rounded-lg" />
          <Skeleton className="h-[62px] w-2/3 rounded-lg" />
          <Skeleton className="h-3 w-full" />
        </div>
        <div className="grid gap-2.5 border-t border-border pt-4">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      </div>
    </div>
  );
}

/**
 * Settings → General: default harness/mode, default model, secrets and
 * custom-node settings. The comment-resolution, worktree-isolation, model
 * pricing and prompt-templates sections are gone — those moved to the resolve
 * template node /Repositories/Integrations or are managed server-side.
 */
export default function SettingsGeneralPage() {
  const { settings, loading, error, setError } = useSettings();

  return (
    <div>
      <header className="mb-7">
        <h1 className="text-lg font-semibold tracking-tight m-0">General</h1>
        <p className="text-muted-foreground text-[13px] mt-1 mb-0">
          Execution defaults (harness, mode, model), custom-node secrets and HTTP allowlist.
        </p>
      </header>

      {error && (
        <Alert variant="destructive" className="mb-5">
          <XCircle size={16} /><span className="flex-1">{error}</span>
        </Alert>
      )}

      {loading ? (
        <GeneralSkeleton />
      ) : settings ? (
        <GeneralSection settings={settings} onError={setError} />
      ) : (
        <p className="text-muted-foreground text-[13px]">
          Settings are unavailable right now — try reloading.
        </p>
      )}
    </div>
  );
}
