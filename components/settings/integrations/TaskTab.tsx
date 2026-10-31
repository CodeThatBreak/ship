"use client";
import { useCallback, useState } from "react";
import { JiraIcon } from "../integration-icons";
import { ConfirmDeleteDialog } from "@/components/shared";
import { INSTANCE_SURFACE, PROVIDER_KIND } from "./constants";
import { useConnectForm } from "./hooks/use-connect-form";
import { useRecordTestResult, testResultKey, useTestResults } from "./hooks/use-test-results";
import {
  useConnectInstance, useInstances, useRemoveInstance, useTestInstance,
} from "./hooks/use-instances";
import { ConnectEmpty } from "./components/ConnectEmpty";
import { ConnectModal } from "./components/ConnectModal";
import { HostingSelect } from "./components/HostingSelect";
import { InstanceCard } from "./components/InstanceCard";
import { ProviderSelect } from "./components/ProviderSelect";
import { InstanceList } from "./components/InstanceList";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { TabProps } from "./types";

// ── Task tab (task providers — Jira for now) ────────────────────────────────

// hoisted option lists — referentially stable across renders
const JIRA_PROVIDER_OPTIONS = [
  { value: PROVIDER_KIND.JIRA, label: "Jira", icon: <JiraIcon size={14} /> },
] as const;

const JIRA_HOSTING_OPTIONS = [
  { value: "cloud", label: "Cloud (atlassian.net)" },
  { value: "custom", label: "Self-hosted (Data Center / Server)" },
] as const;

export function TaskTab({ open, onOpenChange, onError }: TabProps) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const { instances, isPending, isError, refetch } = useInstances(
    INSTANCE_SURFACE.TASK, PROVIDER_KIND.JIRA,
  );
  const connect = useConnectInstance(INSTANCE_SURFACE.TASK, PROVIDER_KIND.JIRA);
  const remove = useRemoveInstance(INSTANCE_SURFACE.TASK, PROVIDER_KIND.JIRA);
  const test = useTestInstance(INSTANCE_SURFACE.TASK, PROVIDER_KIND.JIRA);
  const recordTest = useRecordTestResult();
  const testResults = useTestResults();
  const { state, setProvider, setHosting, setField, reset } = useConnectForm();

  const { provider, hosting, fields } = state;
  const isCustom = hosting === "custom";
  const canConnect = provider === PROVIDER_KIND.JIRA && hosting !== ""
    && Boolean(fields.baseUrl) && Boolean(fields.email) && Boolean(fields.token);

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
        baseUrl: fields.baseUrl,
        email: fields.email,
        token: fields.token,
      },
      { onSuccess: () => { close(); onError(null); }, onError: (e) => onError(e.message) },
    );
  };

  const runTest = useCallback((id: string) => {
    test.mutate(id, {
      onSuccess: (result) => recordTest.mutate({ provider: PROVIDER_KIND.JIRA, id, result }),
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
    <section data-host={PROVIDER_KIND.JIRA} className="flex flex-1 flex-col">
      <InstanceList
        isError={isError}
        onRetry={retryList}
        isPending={isPending}
        isEmpty={instances.length === 0}
        empty={
          <ConnectEmpty
            icon={<JiraIcon />}
            title="No task provider connected"
            description="Connect a task provider — Jira for now — to bring in tasks."
            onConnect={() => onOpenChange(true)}
          />
        }
      >
        {instances.map((i) => (
          <InstanceCard
            key={i.id}
            icon={<JiraIcon size={15} />}
            instance={i}
            testing={test.isPending && test.variables === i.id}
            testResult={testResults[testResultKey(PROVIDER_KIND.JIRA, i.id)]}
            onTest={runTest}
            onDelete={requestDelete}
            deleting={remove.isPending && remove.variables === i.id}
          />
        ))}
      </InstanceList>

      <ConnectModal
        open={open}
        onClose={close}
        title="Connect Jira"
        canSubmit={canConnect}
        submitting={connect.isPending}
        onSubmit={submit}
      >
        <Field>
          <FieldLabel htmlFor="jira-provider">Provider</FieldLabel>
          <ProviderSelect
            id="jira-provider"
            value={provider}
            onChange={setProvider}
            options={JIRA_PROVIDER_OPTIONS}
          />
        </Field>

        {provider === PROVIDER_KIND.JIRA && (
          <Field>
            <FieldLabel htmlFor="jira-hosting-type">Type</FieldLabel>
            <HostingSelect
              id="jira-hosting-type"
              value={hosting}
              onChange={setHosting}
              options={JIRA_HOSTING_OPTIONS}
            />
          </Field>
        )}

        {provider === PROVIDER_KIND.JIRA && hosting !== "" && (
          <>
            <Field>
              <FieldLabel htmlFor="jira-url">URL</FieldLabel>
              <Input
                id="jira-url"
                placeholder={isCustom ? "https://jira.company.com" : "https://your-site.atlassian.net"}
                value={fields.baseUrl ?? ""}
                onChange={(e) => setField("baseUrl", e.target.value)}
              />
            </Field>
            {isCustom && (
              <Field>
                <FieldLabel htmlFor="jira-name">Label</FieldLabel>
                <Input
                  id="jira-name"
                  placeholder="e.g. Corp Jira"
                  value={fields.name ?? ""}
                  onChange={(e) => setField("name", e.target.value)}
                />
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="jira-email">Email</FieldLabel>
              <Input
                id="jira-email"
                placeholder="your Jira login email"
                type="email"
                value={fields.email ?? ""}
                onChange={(e) => setField("email", e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="jira-token">API token</FieldLabel>
              <Input
                id="jira-token"
                placeholder="API token (cloud) or PAT (self-hosted)"
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
        title="Remove Jira connection?"
        description={
          <>
            Disconnects{" "}
            <span className="font-medium">
              {pendingInstance?.name || pendingInstance?.baseUrl || "this instance"}
            </span>
            {" "}and deletes its stored credentials.
          </>
        }
        busy={remove.isPending}
        confirmLabel="Remove connection"
        onConfirm={confirmRemove}
      />
    </section>
  );
}
