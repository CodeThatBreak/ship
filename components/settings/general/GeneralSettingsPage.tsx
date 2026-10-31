"use client";
import { RefreshCw, XCircle } from "lucide-react";
import { GeneralSection } from "./GeneralSection";
import { GeneralSettingsSkeleton } from "../components/GeneralSettingsSkeleton";
import { useSettingsPageError } from "../hooks/useSettingsPageError";
import { useSettingsQuery } from "../hooks/useSettingsQuery";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Settings → General client island — hydrates the prefetched settings query
 * and owns page-scoped action errors.
 */
export const GeneralSettingsPage = () => {
  const { settings, isPending, isError, errorMessage, refetch } = useSettingsQuery();
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
        <h1 className="text-lg font-semibold tracking-tight m-0">General</h1>
        <p className="text-muted-foreground text-[13px] mt-1 mb-0">
          Execution defaults (harness, mode, model), custom-node secrets and HTTP allowlist.
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
        <GeneralSettingsSkeleton />
      ) : isError ? null : settings ? (
        <GeneralSection settings={settings} onError={onError} />
      ) : (
        <p className="text-muted-foreground text-[13px]">
          Settings are unavailable right now — try reloading.
        </p>
      )}
    </div>
  );
};
