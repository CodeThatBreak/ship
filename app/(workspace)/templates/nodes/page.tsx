import { QueryClient, dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { loadNodeCatalog } from "@/loaders/templates";
import { TemplateNodesCatalog } from "@/components/templates/TemplateNodesCatalog";
import { queryKeys } from "@/constants/queryKeys";

export const dynamic = "force-dynamic";

const catalogQueryDefaults = {
  staleTime: 30_000,
  refetchOnWindowFocus: false,
  retry: false,
} as const;

/**
 * Template Nodes — the shared node catalog (§8) — a Server Component. The
 * first paint's rows come from the loader, prefetched into TanStack Query
 * and dehydrated for the catalog island.
 */
export default async function TemplateNodesPage() {
  const nodes = loadNodeCatalog();
  const queryClient = new QueryClient({
    defaultOptions: { queries: catalogQueryDefaults },
  });
  await queryClient.prefetchQuery({
    queryKey: queryKeys.nodeTemplates,
    queryFn: () => nodes,
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TemplateNodesCatalog />
    </HydrationBoundary>
  );
}
