"use client";
import type { ComponentType } from "react";
import { CheckCircle2, Cpu, XCircle } from "lucide-react";
import { CursorIcon, GitLabIcon, JiraIcon } from "../../integration-icons";
import type { Settings } from "../../context";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

/** One entry of the status strip: icon + label + how to read its readiness
 *  from the settings payload. Static — hoisted so the identity is stable. */
const STATUS_ITEMS: ReadonlyArray<{
  label: string;
  icon: ComponentType<{ className?: string }>;
  isOk: (s: Settings) => boolean;
}> = [
  { label: "Cursor (Harness)", icon: CursorIcon, isOk: (s) => Boolean(s.status.cursorApiKeySet || s.status.cursorApiKeyFromEnv) },
  { label: "Local runtime", icon: Cpu, isOk: (s) => s.status.cursorCliAvailable },
  { label: "GitLab", icon: GitLabIcon, isOk: (s) => s.status.gitHosts?.gitlab ?? false },
  { label: "Jira", icon: JiraIcon, isOk: (s) => s.status.taskProviders?.jira ?? false },
];

/** The status strip: harness, local runtime and the configured integrations
 *  (badges go green when the counterpart is ready, amber otherwise). */
export function StatusBar({ settings }: { settings: Settings }) {
  return (
    // flex-row: Card's base styles are flex-col and would stack the badges.
    <Card className="flex-row flex-wrap gap-2.5 items-center px-4 py-3 mb-8">
      <span className="text-[12px] text-muted-foreground uppercase tracking-[1px] mr-1">Status</span>
      {STATUS_ITEMS.map(({ label, icon: Icon, isOk }) => {
        const ok = isOk(settings);
        return (
          <Badge key={label} className={ok ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}>
            <Icon />
            {label}
            {ok ? <CheckCircle2 /> : <XCircle />}
          </Badge>
        );
      })}
    </Card>
  );
}
