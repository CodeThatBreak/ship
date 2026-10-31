"use client";
/**
 * The flow-settings drawer: template meta + how flows start from it, through
 * the shared FlowSettingsBody (Schedule, webhook advanced, the task context).
 */
import { Settings2 } from "lucide-react";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { FlowSettingsBody, type FlowSettingsHook, type RepoOption } from "@/components/templateEditor/FlowSettings";
import type { TaskProviderInfo } from "@/components/templateEditor/types";
import type { Draft } from "@/components/templateEditor/draft";

export interface EditorSettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: Draft;
  readonly: boolean;
  /** the template's provisioned webhook hook (secret/reveal + sample payload) */
  hook: FlowSettingsHook;
  providers: TaskProviderInfo[];
  repos: RepoOption[];
  providersPending?: boolean;
  providersError?: string | null;
  onRetryProviders?: () => void;
  reposPending?: boolean;
  reposError?: string | null;
  onRetryRepos?: () => void;
  templateId: string;
  onTemplateChange: (patch: Partial<Draft["template"]>) => void;
}

export function EditorSettingsDrawer({
  open,
  onOpenChange,
  draft,
  readonly,
  hook,
  providers,
  repos,
  providersPending,
  providersError,
  onRetryProviders,
  reposPending,
  reposError,
  onRetryRepos,
  templateId,
  onTemplateChange,
}: EditorSettingsDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Settings2 size={14} className="text-muted-foreground" /> Flow
            settings
          </SheetTitle>
          <SheetDescription>
            Template meta + how flows start from it.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <FlowSettingsBody
            draft={draft}
            readonly={readonly}
            hook={hook}
            providers={providers}
            repos={repos}
            providersPending={providersPending}
            providersError={providersError}
            onRetryProviders={onRetryProviders}
            reposPending={reposPending}
            reposError={reposError}
            onRetryRepos={onRetryRepos}
            templateId={templateId}
            onChange={onTemplateChange}
          />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
