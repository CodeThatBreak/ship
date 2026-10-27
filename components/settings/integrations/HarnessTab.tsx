"use client";
import { useCallback } from "react";
import { CursorIcon } from "../integration-icons";
import { useSettings } from "../context";
import { PROVIDER_KIND } from "./constants";
import { useConnectForm } from "./hooks/use-connect-form";
import { useUpdateCursorApiKey } from "./hooks/use-cursor-api-key";
import { ConnectEmpty } from "./components/ConnectEmpty";
import { ConnectModal } from "./components/ConnectModal";
import { InstanceCard } from "./components/InstanceCard";
import { LocalAgentOptions, LocalAgentOptionsSkeleton } from "./components/LocalAgentOptions";
import { ProviderSelect } from "./components/ProviderSelect";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useLocalAgentOptions } from "./hooks/use-local-agent-options";
import type { TabProps } from "./types";

// ── Harness tab (agent runners — Cursor for now) ────────────────────────────

// hoisted option list — referentially stable across renders
const CURSOR_PROVIDER_OPTIONS = [
  {
    value: PROVIDER_KIND.CURSOR,
    label: "Cursor",
    icon: <CursorIcon size={14} />,
  },
] as const;

export function HarnessTab({ open, onOpenChange, onError }: TabProps) {
  const { settings } = useSettings();
  const setCursorKey = useUpdateCursorApiKey();
  const localAgent = useLocalAgentOptions();
  const { state, setProvider, setField, reset } = useConnectForm();

  const keySet = settings?.status.cursorApiKeySet ?? false;
  const { provider, fields } = state;
  const canConnect =
    provider === PROVIDER_KIND.CURSOR && Boolean(fields.apiKey);

  // closing (cancel, backdrop, or success) always rolls the stepper back;
  // `reset` is stable so this callback keeps its identity between renders
  const close = useCallback(() => {
    reset();
    onOpenChange(false);
  }, [reset, onOpenChange]);

  const updateKey = (apiKey: string) => {
    setCursorKey.mutate(apiKey, {
      onSuccess: close,
      onError: (e) => onError(e.message),
    });
  };

  return (
    <section
      data-harness={PROVIDER_KIND.CURSOR}
      className="flex flex-1 flex-col"
    >
      {!keySet ? (
        <ConnectEmpty
          icon={<CursorIcon />}
          title="No harness connected"
          description="Connect an agent harness — Cursor for now — to run your agents."
          onConnect={() => onOpenChange(true)}
        />
      ) : (
        <div className="grid gap-2.5 content-start">
          <InstanceCard
            icon={<CursorIcon size={16} />}
            instance={{
              id: "cursor",
              name: "Cursor",
              baseUrl: "https://api.cursor.com",
              tokenMasked: "API key set",
            }}
            onDelete={() => updateKey("")}
          >
            {/* local-run execution settings live inside the harness card once connected */}
            {localAgent.options ? (
              <LocalAgentOptions
                options={localAgent.options}
                savingField={localAgent.savingField}
                onToggle={localAgent.toggle}
              />
            ) : (
              <LocalAgentOptionsSkeleton />
            )}
          </InstanceCard>
        </div>
      )}

      <ConnectModal
        open={open}
        onClose={close}
        title="Connect Cursor"
        canSubmit={canConnect}
        submitting={setCursorKey.isPending}
        onSubmit={() => updateKey(fields.apiKey)}
      >
        <Field>
          <FieldLabel>Provider</FieldLabel>
          <ProviderSelect
            value={provider}
            onChange={setProvider}
            options={CURSOR_PROVIDER_OPTIONS}
          />
        </Field>

        {provider === PROVIDER_KIND.CURSOR && (
          <Field>
            <FieldLabel htmlFor="cursor-api-key">API key</FieldLabel>
            <Input
              id="cursor-api-key"
              placeholder="Cursor API key"
              type="password"
              value={fields.apiKey ?? ""}
              onChange={(e) => setField("apiKey", e.target.value)}
              className="font-mono text-[12px]"
            />
            <a
              href="https://cursor.com/dashboard/api"
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-info hover:underline"
            >
              Create a key at cursor.com/dashboard/api ↗
            </a>
          </Field>
        )}
      </ConnectModal>
    </section>
  );
}
