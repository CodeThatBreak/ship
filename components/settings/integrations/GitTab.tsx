"use client";
import { useCallback, useState } from "react";
import { GitLabIcon } from "../integrationIcons";
import { ConfirmDeleteDialog } from "@/components/shared/ConfirmDeleteDialog";
import { HOSTING, INSTANCE_SURFACE, PROVIDER_KIND } from "./constants";
import { useConnectForm } from "./hooks/useConnectForm";
import { useRecordTestResult, testResultKey, useTestResults } from "./hooks/useTestResults";
import {
  useConnectInstance, useInstances, useRemoveInstance, useTestInstance,
} from "./hooks/useInstances";
import { ConnectEmpty } from './components/connect/ConnectEmpty';
import { ConnectModal } from './components/connect/ConnectModal';
import { HostingSelect } from "./components/HostingSelect";
import { InstanceCard } from './components/instances/InstanceCard';
import { ProviderSelect } from "./components/ProviderSelect";
import { InstanceList } from './components/instances/InstanceList';
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { TabProps } from "./types";

// ── Git tab (git hosts — GitLab for now) ────────────────────────────────────

// hoisted option lists — referentially stable across renders
const GIT_PROVIDER_OPTIONS = [
  { value: PROVIDER_KIND.GITLAB, label: "GitLab", icon: <GitLabIcon size={14} /> },
] as const;

const GIT_HOSTING_OPTIONS = [
  { value: HOSTING.CLOUD, label: "Cloud (gitlab.com)" },
  { value: HOSTING.CUSTOM, label: "Self-hosted (custom URL)" },
] as const;

export function GitTab({ open, onOpenChange, onError }: TabProps) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const { instances, isPending, isError, refetch } = useInstances(
    INSTANCE_SURFACE.HOST, PROVIDER_KIND.GITLAB,
  );
  const connect = useConnectInstance(INSTANCE_SURFACE.HOST, PROVIDER_KIND.GITLAB);
  const remove = useRemoveInstance(INSTANCE_SURFACE.HOST, PROVIDER_KIND.GITLAB);
  const test = useTestInstance(INSTANCE_SURFACE.HOST, PROVIDER_KIND.GITLAB);
  const recordTest = useRecordTestResult();
  const testResults = useTestResults();
  const { state, setProvider, setHosting, setField, reset } = useConnectForm();

  const { provider, hosting, fields } = state;
  const isCustom = hosting === "custom";
  const canConnect = provider === PROVIDER_KIND.GITLAB && hosting !== ""
    && (isCustom ? Boolean(fields.baseUrl) : true)
    && Boolean(fields.token);

  // closing (cancel, backdrop, or success) always rolls the stepper back;
  // `reset` is stable so this callback keeps its identity between renders
  const close = useCallback(() => {
    reset();
    onOpenChange(false);
  }, [reset, onOpenChange]);

  const submit = () => {
    connect.mutate(
      {
        name: isCustom ? fields.name : null,
        baseUrl: isCustom ? fields.baseUrl : "https://gitlab.com",
        token: fields.token,
      },
      { onSuccess: () => { close(); onError(null); }, onError: (e) => onError(e.message) },
    );
  };

  const runTest = useCallback((id: string) => {
    test.mutate(id, {
      onSuccess: (result) =>
        recordTest.mutate({ provider: PROVIDER_KIND.GITLAB, id, result }),
      onError: (e) => onError(e.message),
    });
  }, [test, recordTest, onError]);

  const requestDelete = useCallback((id: string) => {
    setPendingDeleteId(id);
  }, []);

  const retryList = useCallback(() => {
    void refetch();
  }, [refetch]);

  const pendingInstance = pendingDeleteId
    ? instances.find((i) => i.id === pendingDeleteId) ?? null
    : null;

  const confirmRemove = () => {
    if (!pendingDeleteId) return;
    remove.mutate(pendingDeleteId, {
      onSuccess: () => {
        setPendingDeleteId(null);
        onError(null);
      },
      onError: (e) => onError(e.message),
    });
  };

  return (
    <section data-host={PROVIDER_KIND.GITLAB} className="flex flex-1 flex-col">
      <InstanceList
        isError={isError}
        onRetry={retryList}
        isPending={isPending}
        isEmpty={instances.length === 0}
        empty={
          <ConnectEmpty
            icon={<GitLabIcon />}
            title="No git provider connected"
            description="Connect a GitLab instance — cloud (gitlab.com) or self-hosted — to work with your repos."
            onConnect={() => onOpenChange(true)}
          />
        }
      >
        {instances.map((i) => (
          <InstanceCard
            key={i.id}
            icon={<GitLabIcon size={16} />}
            instance={i}
            testing={test.isPending && test.variables === i.id}
            testResult={testResults[testResultKey(PROVIDER_KIND.GITLAB, i.id)]}
            onTest={runTest}
            onDelete={requestDelete}
            deleting={remove.isPending && remove.variables === i.id}
          />
        ))}
      </InstanceList>

      <ConnectModal
        open={open}
        onClose={close}
        title="Connect GitLab"
        canSubmit={canConnect}
        submitting={connect.isPending}
        onSubmit={submit}
      >
        <Field>
          <FieldLabel htmlFor="gitlab-provider">Provider</FieldLabel>
          <ProviderSelect
            id="gitlab-provider"
            value={provider}
            onChange={setProvider}
            options={GIT_PROVIDER_OPTIONS}
          />
        </Field>

        {provider === PROVIDER_KIND.GITLAB && (
          <Field>
            <FieldLabel htmlFor="gitlab-hosting-type">Type</FieldLabel>
            <HostingSelect
              id="gitlab-hosting-type"
              value={hosting}
              onChange={setHosting}
              options={GIT_HOSTING_OPTIONS}
            />
          </Field>
        )}

        {provider === PROVIDER_KIND.GITLAB && hosting !== "" && (
          <>
            {isCustom && (
              <div className="grid gap-3.5">
                <Field>
                  <FieldLabel htmlFor="gitlab-name">Label</FieldLabel>
                  <Input
                    id="gitlab-name"
                    placeholder="e.g. Corp GitLab"
                    value={fields.name ?? ""}
                    onChange={(e) => setField("name", e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="gitlab-url">URL</FieldLabel>
                  <Input
                    id="gitlab-url"
                    placeholder="https://gitlab.company.com"
                    value={fields.baseUrl ?? ""}
                    onChange={(e) => setField("baseUrl", e.target.value)}
                  />
                </Field>
              </div>
            )}
            <Field>
              <FieldLabel htmlFor="gitlab-token">Access token</FieldLabel>
              <Input
                id="gitlab-token"
                placeholder="Personal access token (api scope)"
                type="password"
                value={fields.token ?? ""}
                onChange={(e) => setField("token", e.target.value)}
              />
            </Field>
          </>
        )}
      </ConnectModal>

      <ConfirmDeleteDialog
        open={pendingDeleteId != null}
        onClose={() => setPendingDeleteId(null)}
        title="Remove GitLab connection?"
        description={
          <>
            Disconnects{" "}
            <span className="font-medium">
              {pendingInstance?.name || pendingInstance?.baseUrl || "this instance"}
            </span>
            {" "}and deletes its stored token.
          </>
        }
        busy={remove.isPending}
        confirmLabel="Remove connection"
        onConfirm={confirmRemove}
      />
    </section>
  );
}
