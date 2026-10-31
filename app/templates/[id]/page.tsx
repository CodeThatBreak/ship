/**
 * The template editor route (§8, Phase 5) — SSR boot. Awaits the route
 * params (Next 15), validates the template id server-side (notFound on a
 * miss), and prefetches the editor's query cache by calling the services
 * directly (the same mappings the API routes use — `loaders/templates`). The
 * dehydrated state hydrates the client island (dehydrate + HydrationBoundary
 * over the root layout's QueryClientProvider); ALL editor interactivity
 * lives behind the client boundary in components/builder/.
 */
import { notFound } from "next/navigation";
import { QueryClient, dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { loadEditorBoot } from "@/loaders/templates";
import { TemplateEditor } from "@/components/builder";

export const dynamic = "force-dynamic";

export default async function TemplateEditorRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const boot = loadEditorBoot(id);
  if (!boot) notFound();

  // the editor's first paint never fetches: the boot data lands in the same
  // query keys the client island reads (query keys' single source of truth)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // mirror app/providers.tsx so SSR + client read the same freshness
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: false,
      },
    },
  });
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: queryKeys.templates.detail(boot.detail.template.id),
      queryFn: () => boot.detail,
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.templatesCatalog(boot.detail.template.id),
      queryFn: () => boot.catalog,
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.taskProviders,
      queryFn: () => boot.providers,
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.repoChoices,
      queryFn: () => boot.repos,
    }),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {/* the id in the key resets the island's draft/drawers/local buffers on
          a client-side navigation to a different template (§2.6 key-reset) */}
      <TemplateEditor key={boot.detail.template.id} templateId={boot.detail.template.id} />
    </HydrationBoundary>
  );
}
