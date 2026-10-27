"use client";
import { useCallback } from "react";
import { JiraIcon } from "../integration-icons";
import { INSTANCE_SURFACE, PROVIDER_KIND } from "./constants";
import { useConnectForm } from "./hooks/use-connect-form";
import { useRecordTestResult, testResultKey, useTestResults } from "./hooks/use-test-results";
import {
  useConnectInstance, useInstances, useRemoveInstance, useTestInstance,
} from "./hooks/use-instances";
import { ConnectEmpty } from "./components/ConnectEmpty";
import { ConnectModal } from "./components/ConnectModal";
import { HostingSelect } from "./components/HostingSelect";
import { InstanceCard, InstanceCardSkeleton } from "./components/InstanceCard";
import { ProviderSelect } from "./components/ProviderSelect";
import { InstanceListError } from "./components/InstanceListError";
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
      { onSuccess: close, onError: (e) => onError(e.message) },
    );
  };

  const runTest = (id: string) => {
    test.mutate(id, {
      onSuccess: (result) => recordTest.mutate({ provider: PROVIDER_KIND.JIRA, id, result }),
    });
  };

  return (
    <section data-host={PROVIDER_KIND.JIRA} className="flex flex-1 flex-col">
      {isError ? (
        <InstanceListError onRetry={() => void refetch()} />
      ) : isPending ? (
        <div className="grid gap-2.5">
          <InstanceCardSkeleton />
          <InstanceCardSkeleton />
          <InstanceCardSkeleton />
        </div>
      ) : instances.length === 0 ? (
        <ConnectEmpty
          icon={<JiraIcon />}
          title="No task provider connected"
          description="Connect a task provider — Jira for now — to bring in tasks."
          onConnect={() => onOpenChange(true)}
        />
      ) : (
        <div className="grid gap-2.5 content-start">
          {instances.map((i) => (
            <InstanceCard
              key={i.id}
              icon={<JiraIcon size={15} />}
              instance={i}
              testing={test.isPending && test.variables === i.id}
              testResult={testResults[testResultKey(PROVIDER_KIND.JIRA, i.id)]}
              onTest={() => runTest(i.id)}
              onDelete={() => remove.mutate(i.id)}
            />
          ))}
        </div>
      )}

      <ConnectModal
        open={open}
        onClose={close}
        title="Connect Jira"
        canSubmit={canConnect}
        submitting={connect.isPending}
        onSubmit={submit}
      >
        <Field>
          <FieldLabel>Provider</FieldLabel>
          <ProviderSelect value={provider} onChange={setProvider} options={JIRA_PROVIDER_OPTIONS} />
        </Field>

        {provider === PROVIDER_KIND.JIRA && (
          <Field>
            <FieldLabel>Type</FieldLabel>
            <HostingSelect value={hosting} onChange={setHosting} options={JIRA_HOSTING_OPTIONS} />
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
    </section>
  );
}
