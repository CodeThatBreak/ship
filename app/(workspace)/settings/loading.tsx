import { Skeleton } from "@/components/ui/skeleton";
import { GeneralSettingsSkeleton } from "@/components/settings/components/GeneralSettingsSkeleton";

/**
 * Settings sub-route loading state: mirrors the default /settings (General)
 * layout. Each sub-page client island renders its own feature-shaped skeleton
 * when its query is still pending.
 */
export default function SettingsLoading() {
  return (
    <div aria-busy="true">
      <header className="mb-7">
        <Skeleton className="h-6 w-28 rounded-lg" />
        <Skeleton className="mt-1 h-4 w-[380px]" />
      </header>
      <GeneralSettingsSkeleton />
    </div>
  );
}
