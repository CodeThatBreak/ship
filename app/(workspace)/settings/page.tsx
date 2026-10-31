import { QueryClient, dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { settingsQueryOptions } from "@/components/settings/queries";
import { GeneralSettingsPage } from "@/components/settings/general/GeneralSettingsPage";
import { loadSettings } from "@/loaders/settings";

export const dynamic = "force-dynamic";

const settingsQueryDefaults = {
  staleTime: 30_000,
  refetchOnWindowFocus: false,
  retry: false,
} as const;

/** Settings → General — server-prefetched settings query. */
export default async function SettingsGeneralPage() {
  const settings = await loadSettings();
  const queryClient = new QueryClient({
    defaultOptions: { queries: settingsQueryDefaults },
  });
  await queryClient.prefetchQuery({
    ...settingsQueryOptions(),
    queryFn: () => settings,
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <GeneralSettingsPage />
    </HydrationBoundary>
  );
}
