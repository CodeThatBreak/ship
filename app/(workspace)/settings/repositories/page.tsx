import { reposQueryOptions } from "@/components/settings/queries";
import { RepositoriesSettingsPage } from "@/components/settings/repos/RepositoriesSettingsPage";
import { loadReposPayload } from "@/loaders/settings";
import { QueryClient, dehydrate, HydrationBoundary } from "@tanstack/react-query";

export const dynamic = "force-dynamic";

const reposQueryDefaults = {
  staleTime: 30_000,
  refetchOnWindowFocus: false,
  retry: false,
} as const;

/** Settings → Repositories — server-prefetched repo list. */
export default async function SettingsRepositoriesPage() {
  const payload = loadReposPayload();
  const queryClient = new QueryClient({
    defaultOptions: { queries: reposQueryDefaults },
  });
  await queryClient.prefetchQuery({
    ...reposQueryOptions(),
    queryFn: () => payload,
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <RepositoriesSettingsPage />
    </HydrationBoundary>
  );
}
