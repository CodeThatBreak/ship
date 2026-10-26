/**
 * The builder's loading skeleton: mirrors the fullscreen editor layout —
 * the header bar (back link, template title, undo/redo/save buttons), the
 * node palette rail on the left and the empty canvas with repositionable
 * node chips. Rendered by the route's loading.tsx and again inline while
 * the client island waits for a detail refetch that has no data.
 */
import { Skeleton } from "@/components/ui/skeleton";

export function EditorLoading() {
  return (
    <main aria-busy="true" className="fixed inset-0 flex flex-col bg-background">
      <header className="h-14 shrink-0 flex items-center gap-3 px-4 border-b border-border bg-card">
        <Skeleton className="h-7 w-24 rounded-lg" />
        <Skeleton className="size-5 rounded-lg" />
        <div className="grid gap-1.5">
          <Skeleton className="h-4 w-52" />
          <Skeleton className="h-3 w-36" />
        </div>
        <div className="flex-1" />
        <Skeleton className="h-7 w-[132px] rounded-lg" />
        <Skeleton className="size-7 rounded-lg" />
        <Skeleton className="size-7 rounded-lg" />
        <Skeleton className="h-7 w-20 rounded-lg" />
      </header>

      <div className="flex-1 min-h-0 flex">
        <aside className="w-64 shrink-0 border-r border-border bg-card flex flex-col min-h-0">
          <Skeleton className="h-3 w-14 mb-2 ml-3 mt-3" />
          <div className="grid gap-2 px-3 content-start">
            {Array.from({ length: 7 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded-lg" />
            ))}
          </div>
        </aside>
        <div className="flex-1 min-w-0 grid place-items-center">
          <div className="grid grid-cols-3 gap-10">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-44 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
