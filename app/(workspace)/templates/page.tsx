import { QueryClient, dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { loadTemplateGallery } from "@/loaders/templates";
import { TemplateGallery } from "@/components/templates/TemplateGallery";
import { queryKeys } from "@/constants/queryKeys";

export const dynamic = "force-dynamic";

const galleryQueryDefaults = {
  staleTime: 30_000,
  refetchOnWindowFocus: false,
  retry: false,
} as const;

/**
 * The template gallery (§8) — a Server Component. The first paint's rows
 * come from the loader (the exact templateStore call the thin /api/templates
 * GET wraps — no HTTP hop), prefetched into TanStack Query and dehydrated
 * for the gallery island.
 */
export default async function TemplatesPage() {
  const templates = loadTemplateGallery();
  const queryClient = new QueryClient({
    defaultOptions: { queries: galleryQueryDefaults },
  });
  await queryClient.prefetchQuery({
    queryKey: queryKeys.templatesGallery,
    queryFn: () => templates,
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TemplateGallery />
    </HydrationBoundary>
  );
}
