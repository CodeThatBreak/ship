"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Modal } from "@/components/shared";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ExecutionMode,
  LiveTask,
  RepoSummary,
  TemplateOption,
} from "@/types/tasks";
import { useStartBuild } from "./hooks/use-start-build";
import { StatusBadge, TypeChip } from "./TaskBadges";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * The "Start build" modal: repo/template/execution-mode pick, then the start
 * chain (use-start-build). Mounts fresh per picked task so the selects reset.
 */
export function BuildModal({ task, repos, templates, defaultMode, defaultTemplateId, onClose }: {
  task: LiveTask;
  repos: RepoSummary[];
  templates: TemplateOption[];
  defaultMode: ExecutionMode;
  defaultTemplateId: string;
  onClose: () => void;
}) {
  const [repoId, setRepoId] = useState("");
  const [executionMode, setExecutionMode] = useState<ExecutionMode>(defaultMode);
  const [templateId, setTemplateId] = useState(defaultTemplateId);
  const router = useRouter();

  const selectedRepo = repos.find((r) => r.id === repoId);
  const start = useStartBuild((flowId) => {
    onClose();
    router.push(`/flows/${flowId}`);
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Start build"
      className="sm:max-w-[520px]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              selectedRepo &&
              start.mutate({
                task,
                repo: selectedRepo,
                executionMode,
                templateId,
              })
            }
            disabled={!selectedRepo || start.isPending}
          >
            {start.isPending ? (
              <>
                <Loader2 size={13} className="animate-spin" /> Starting…
              </>
            ) : (
              <>
                <Play size={13} /> Start build
              </>
            )}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* task summary */}
        <div className="flex items-start gap-2.5">
          <TypeChip task={task} />
          <div className="min-w-0">
            <div className="text-[13.5px] font-medium leading-snug">
              {task.summary}
            </div>
            <div className="mt-1 flex gap-1.5 items-center">
              <StatusBadge status={task.status} />
              {task.priority && (
                <Badge variant="outline" className="text-[11px]">
                  {task.priority}
                </Badge>
              )}
            </div>
          </div>
        </div>

        <Separator />

        {start.error && (
          <Alert variant="destructive">
            <span>{start.error.message}</span>
          </Alert>
        )}

        <Field>
          <FieldLabel htmlFor="flow-template">Flow template</FieldLabel>
          <Select value={templateId} onValueChange={(v) => v && setTemplateId(v)}>
            <SelectTrigger id="flow-template" className="w-full">
              <SelectValue placeholder="Select template…" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="flow-repo">Repository</FieldLabel>
          <Select value={repoId || null} onValueChange={(v) => v && setRepoId(v)}>
            <SelectTrigger id="flow-repo" className="w-full">
              <SelectValue placeholder="Select repo…" />
            </SelectTrigger>
            <SelectContent>
              {repos.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name} — {hostOf(r.cloud_url)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="flow-execution-mode">Execution mode</FieldLabel>
          <Select
            value={executionMode}
            onValueChange={(v) => v && setExecutionMode(v as ExecutionMode)}
          >
            <SelectTrigger id="flow-execution-mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cloud">
                Cloud agent
              </SelectItem>
              <SelectItem value="local" disabled={!selectedRepo?.local_path}>
                Local (SDK)
                {!selectedRepo?.local_path && (
                  <span className="text-warning">(no local path)</span>
                )}
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
