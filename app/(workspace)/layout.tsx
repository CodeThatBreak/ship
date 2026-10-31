import { AppSidebar } from "@/components/layout/AppSidebar";
import { StatusBar } from '@/components/flows/components/StatusBar';

/**
 * Persistent shell for workspace pages (tasks, flows, templates, settings).
 * Fullscreen work surfaces — the flow cockpit (`/flows/[id]`) and the template
 * editor (`/templates/[id]`) — live outside this route group and opt out.
 */
export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-1">
        <AppSidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="mx-auto w-full max-w-[1440px] flex-1 px-8 py-8">
            {children}
          </div>
        </main>
      </div>
      {/* IDE-style status bar: running agents, open MRs (polls /api/status).
          Spans the full viewport width, below the sidebar like an IDE. */}
      <StatusBar />
    </div>
  );
}
