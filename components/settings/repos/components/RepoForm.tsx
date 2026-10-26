"use client";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SetupTestPanel } from "./SetupTestPanel";
import type { RepoFormState } from "../types";

/**
 * The add/edit repo body: identity fields, then the worktree setup policy.
 * Policy fields arrive prefilled with DevFlow's detected values (see
 * /api/repos/detect), command fields are textareas, toggles render as a
 * horizontal Field + Switch, and every placeholder is an example only — all
 * explanation lives in the FieldDescription help text.
 */
export function RepoForm({
  form, setField, detectedSource,
}: {
  form: RepoFormState;
  setField: <K extends keyof RepoFormState>(key: K, value: RepoFormState[K]) => void;
  detectedSource?: string | null;
}) {
  return (
    <>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="repo-name">Name</FieldLabel>
          <FieldDescription>Shown wherever flows pick a repo.</FieldDescription>
          <Input
            id="repo-name"
            placeholder="payments-api"
            value={form.name}
            onChange={(e) => setField("name", e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="repo-default-branch">Default branch</FieldLabel>
          <FieldDescription>Branch worktrees start from.</FieldDescription>
          <Input
            id="repo-default-branch"
            placeholder="main"
            value={form.default_branch}
            onChange={(e) => setField("default_branch", e.target.value)}
          />
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="repo-cloud-url">Cloud URL</FieldLabel>
        <FieldDescription>Git clone URL used for cloud-mode runs.</FieldDescription>
        <Input
          id="repo-cloud-url"
          placeholder="https://gitlab.company.com/group/repo"
          value={form.cloud_url}
          onChange={(e) => setField("cloud_url", e.target.value)}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="repo-local-path">Local path</FieldLabel>
        <FieldDescription>
          Optional existing checkout for local runs — must be a git repo.
        </FieldDescription>
        <Input
          id="repo-local-path"
          placeholder="~/work/repo"
          className="font-mono text-[12px]"
          value={form.local_path}
          onChange={(e) => setField("local_path", e.target.value)}
        />
      </Field>

      <div className="border-t border-border pt-3">
        <div className="text-[13px] font-medium">Worktree setup policy</div>
        <p className="text-muted-foreground text-[11.5px] leading-snug mt-1 mb-0">
          {detectedSource
            ? <>Auto-detected: <span className="font-mono">{detectedSource}</span> — fields you fill win over it.</>
            : "Fields you fill win over auto-detection."}
        </p>

        <div className="grid gap-3.5 mt-3">
          <Field>
            <FieldLabel htmlFor="repo-install-command">Install command</FieldLabel>
            <FieldDescription>
              Overrides the auto-detected package install in a new worktree.
            </FieldDescription>
            <Textarea
              id="repo-install-command"
              placeholder="pnpm install --filter web"
              className="font-mono text-[12px] min-h-9"
              value={form.install_command}
              onChange={(e) => setField("install_command", e.target.value)}
            />
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="repo-skip-install">Skip install</FieldLabel>
              <FieldDescription>
                Don&apos;t run any install command in new worktrees.
              </FieldDescription>
            </FieldContent>
            <Switch
              id="repo-skip-install"
              size="sm"
              checked={form.skip_install}
              onCheckedChange={(checked) => setField("skip_install", Boolean(checked))}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="repo-setup-command">Setup command</FieldLabel>
            <FieldDescription>
              Runs last in a new worktree, after install and sync.
            </FieldDescription>
            <Textarea
              id="repo-setup-command"
              placeholder="make bootstrap"
              className="font-mono text-[12px] min-h-9"
              value={form.setup_command}
              onChange={(e) => setField("setup_command", e.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="repo-sync-paths">Sync paths</FieldLabel>
            <FieldDescription>
              Globs copied from the checkout into each worktree, one per line.
            </FieldDescription>
            <Textarea
              id="repo-sync-paths"
              placeholder={".env*\n*.rc"}
              className="font-mono text-[12px] min-h-16"
              value={form.sync_paths}
              onChange={(e) => setField("sync_paths", e.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="repo-shared-dirs">Symlinks</FieldLabel>
            <FieldDescription>
              Directories symlinked into each worktree instead of copied — caches.
            </FieldDescription>
            <Textarea
              id="repo-shared-dirs"
              placeholder={"node_modules/.cache\n.turbo"}
              className="font-mono text-[12px] min-h-16"
              value={form.shared_dirs}
              onChange={(e) => setField("shared_dirs", e.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="repo-worktree-timeout">Worktree timeout (seconds)</FieldLabel>
            <FieldDescription>
              Time allowed to create the worktree checkout. Raise this for very
              large repos — the default is 120s and a timeout fails the node.
            </FieldDescription>
            <Input
              id="repo-worktree-timeout"
              type="number"
              min={1}
              placeholder="120"
              value={form.worktree_timeout_s}
              onChange={(e) => setField("worktree_timeout_s", e.target.value)}
            />
          </Field>

          <SetupTestPanel form={form} />
        </div>
      </div>
    </>
  );
}
