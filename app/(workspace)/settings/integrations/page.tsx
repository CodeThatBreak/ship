"use client";
import { useState } from "react";
import { Cpu, GitBranch, ListTree, Link2, XCircle } from "lucide-react";
import { useSettings } from "@/components/settings/context";
import { GitTab, HarnessTab, TaskTab } from "@/components/settings/integrations";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Loading placeholder that mirrors the tabs row + instance-card layout. */
function IntegrationsSkeleton() {
  return (
    <div aria-hidden className="flex-1">
      <div className="flex items-center justify-between gap-3 mb-2">
        <Skeleton className="h-8 w-[286px] rounded-lg" />
        <Skeleton className="h-8 w-[104px] rounded-lg" />
      </div>
      <div className="grid gap-2.5">
        <Skeleton className="h-[70px] w-full rounded-lg" />
        <Skeleton className="h-[70px] w-full rounded-lg" />
        <Skeleton className="h-[70px] w-2/3 rounded-lg" />
      </div>
    </div>
  );
}

/**
 * Settings → Integrations: one tab per integration surface — Git (git-host
 * instances), Task (task provider instances) and Harness (agent runners).
 * The Connect button (next to the tabs) opens the active tab's connect modal.
 */
export default function SettingsIntegrationsPage() {
  const { loading, error, setError } = useSettings();
  const [tab, setTab] = useState("git");
  const [connectOpen, setConnectOpen] = useState(false);

  return (
    <div className="flex min-h-full flex-col">
      <header className="mb-7">
        <h1 className="text-lg font-semibold tracking-tight m-0">Integrations</h1>
        <p className="text-muted-foreground text-[13px] mt-1 mb-0">
          Credentials for your git hosts, task providers and the agent harness.
        </p>
      </header>

      {error && (
        <Alert variant="destructive" className="mb-5">
          <XCircle size={16} /><span className="flex-1">{error}</span>
        </Alert>
      )}

      {loading ? (
        <IntegrationsSkeleton />
      ) : (
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v ?? "git")}
          className="flex-1"
        >
          <div className="flex items-center justify-between gap-3 mb-2">
            <TabsList>
              <TabsTrigger value="git"><GitBranch /> Git</TabsTrigger>
              <TabsTrigger value="task"><ListTree /> Task</TabsTrigger>
              <TabsTrigger value="harness"><Cpu /> Harness</TabsTrigger>
            </TabsList>
            <Button size="sm" variant="outline" onClick={() => setConnectOpen(true)}>
              <Link2 size={13} /> Connect
            </Button>
          </div>

          <TabsContent value="git" className="flex flex-1 flex-col">
            <GitTab open={connectOpen} onOpenChange={setConnectOpen} onError={setError} />
          </TabsContent>
          <TabsContent value="task" className="flex flex-1 flex-col">
            <TaskTab open={connectOpen} onOpenChange={setConnectOpen} onError={setError} />
          </TabsContent>
          <TabsContent value="harness" className="flex flex-1 flex-col">
            <HarnessTab open={connectOpen} onOpenChange={setConnectOpen} onError={setError} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
