"use client";
import { useCallback } from "react";
import { GitLabIcon } from "../integration-icons";
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
import { Field } from "@/components/shared";
import { Input } from "@/components/ui/input";
import type { TabProps } from "./types";

// ── Git tab (git hosts — GitLab for now) ────────────────────────────────────

// hoisted option lists — referentially stable across renders
const GIT_PROVIDER_OPTIONS = [
  { value: PROVIDER_KIND.GITLAB, label: "GitLab", icon: <GitLabIcon size={14} /> },
] as const;

const GIT_HOSTING_OPTIONS = [
  { value: "cloud", label: "Cloud (gitlab.com)" },
  { value: "custom", label: "Self-hosted (custom URL)" },
] as const;

export function GitTab({ open, onOpenChange, onError }: TabProps) {
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
      { onSuccess: close, onError: (e) => onError(e.message) },
    );
  };

  const runTest = (id: string) => {
    test.mutate(id, {
      onSuccess: (result) =>
        recordTest.mutate({ provider: PROVIDER_KIND.GITLAB, id, result }),
    });
  };

  return (
    <section data-host={PROVIDER_KIND.GITLAB} className="flex flex-1 flex-col">
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
          icon={<GitLabIcon />}
          title="No git provider connected"
          description="Connect a GitLab instance — cloud (gitlab.com) or self-hosted — to work with your repos."
          onConnect={() => onOpenChange(true)}
        />
      ) : (
        <div className="grid gap-2.5 content-start">
          {instances.map((i) => (
            <InstanceCard
              key={i.id}
              icon={<GitLabIcon size={16} />}
              instance={i}
              testing={test.isPending && test.variables === i.id}
              testResult={testResults[testResultKey(PROVIDER_KIND.GITLAB, i.id)]}
              onTest={() => runTest(i.id)}
              onDelete={() => remove.mutate(i.id)}
            />
          ))}
        </div>
      )}

      <ConnectModal
        open={open}
        onClose={close}
        title="Connect GitLab"
        canSubmit={canConnect}
        submitting={connect.isPending}
        onSubmit={submit}
      >
        <Field label="Provider">
          <ProviderSelect value={provider} onChange={setProvider} options={GIT_PROVIDER_OPTIONS} />
        </Field>

        {provider === PROVIDER_KIND.GITLAB && (
          <Field label="Type">
            <HostingSelect value={hosting} onChange={setHosting} options={GIT_HOSTING_OPTIONS} />
          </Field>
        )}

        {provider === PROVIDER_KIND.GITLAB && hosting !== "" && (
          <>
            {isCustom && (
              <div className="grid gap-3.5">
                <Field label="Label">
                  <Input
                    placeholder="e.g. Corp GitLab"
                    value={fields.name ?? ""}
                    onChange={(e) => setField("name", e.target.value)}
                  />
                </Field>
                <Field label="URL">
                  <Input
                    placeholder="https://gitlab.company.com"
                    value={fields.baseUrl ?? ""}
                    onChange={(e) => setField("baseUrl", e.target.value)}
                  />
                </Field>
              </div>
            )}
            <Field label="Access token">
              <Input
                placeholder="Personal access token (api scope)"
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
