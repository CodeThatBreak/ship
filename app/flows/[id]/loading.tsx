import { Skeleton } from "@/components/ui/skeleton";

/**
 * Flow cockpit loading state: mirrors the fullscreen split layout — the
 * header bar (back link, task badge, title, mode badge), the graph strip
 * with node chips, and the node-panel/chat-rail split below.
 */
export default function FlowLoading() {
  return (
    <main aria-busy="true" className="flex h-screen flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border bg-card px-4">
        <Skeleton className="h-6 w-24 rounded-lg" />
        <Skeleton className="h-4 w-px" />
        <Skeleton className="h-5 w-20 rounded-lg" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-5 w-16 rounded-lg" />
        <div className="flex-1" />
        <Skeleton className="h-5 w-24 rounded-lg" />
      </header>

      <div className="border-b border-border bg-background px-3 py-2.5 overflow-x-auto">
        <div className="flex items-center gap-2.5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-40 shrink-0 rounded-lg" />
          ))}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <section className="flex-[1.6] border-r border-border grid gap-3 content-start p-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-3 w-2/3" />
        </section>
        <aside className="flex-1 flex flex-col bg-card min-w-[340px] p-3.5">
          <div className="grid gap-2.5 content-start">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        </aside>
      </div>
    </main>
  );
}
