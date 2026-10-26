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
import {
  FlowSettingsBody,
  type FlowSettingsHook,
  type RepoOption,
  type TaskProviderInfo,
} from "@/components/template-editor";
import type { Draft } from "@/components/template-editor";

export interface EditorSettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: Draft;
  readonly: boolean;
  /** the template's provisioned webhook hook (secret/reveal + sample payload) */
  hook: FlowSettingsHook;
  providers: TaskProviderInfo[];
  repos: RepoOption[];
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
            templateId={templateId}
            onChange={onTemplateChange}
          />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
