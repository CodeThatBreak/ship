"use client";
import { useCallback, useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import type { Settings } from "../../context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SECRET_MODAL_TITLE, SECRETS_USAGE } from "../constants";
import { formFromSecret, useSecretForm } from "../hooks/use-secret-form";
import { useSecretMutations } from "../hooks/use-secret-mutations";
import { HttpAllowlist } from "./HttpAllowlist";
import { SecretForm } from "./SecretForm";
import { SecretModal } from "./SecretModal";
import { SecretRow } from "./SecretRow";
import { SectionHeading } from "./SectionHeading";

/**
 * Settings → Custom nodes: write-only secrets for `{{secrets.NAME}}`
 * interpolation in http nodes (managed through the add/edit modal) and the
 * outbound hostname allowlist the SSRF guard enforces. Each modal save PATCHes
 * `secrets` independently — `{name: value}` upserts, `{name: null}` deletes,
 * absent keys stay untouched.
 */
export function CustomNodesSection({ settings, onError }: {
  settings: Settings;
  onError: (e: string | null) => void;
}) {
  const secrets = settings.secrets ?? [];
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const { state, setField, replace, reset } = useSecretForm();
  const { patchSecrets, isPending } = useSecretMutations();

  const openAdd = useCallback(() => {
    reset();
    setEditingName(null);
    setEditorOpen(true);
  }, [reset]);
  const openEdit = useCallback((name: string) => {
    replace(formFromSecret(name));
    setEditingName(name);
    setEditorOpen(true);
  }, [replace]);
  // closing (cancel, backdrop, or success) always rolls the form back;
  // `reset` is stable so this callback keeps its identity between renders
  const close = useCallback(() => {
    reset();
    setEditingName(null);
    setEditorOpen(false);
  }, [reset]);

  // derived validity: a name is always required; a value is required when
  // adding, and when renaming (values never leave the server, so a rename
  // must carry the value again); renaming onto a set name is an upsert
  const name = state.name.trim();
  const renaming = editingName !== null && name !== editingName;
  const canSubmit = Boolean(name) && (Boolean(state.value) || !(renaming || editingName === null));

  /** Modal save: a rename writes the new name and deletes the old one in one
   *  PATCH; a same-name edit with a new value upserts it; an unchanged edit
   *  with an empty value keeps the stored value — nothing is written. */
  const submit = useCallback(() => {
    const editing = editingName;
    if (editing !== null && name !== editing) {
      patchSecrets(
        { [name]: state.value, [editing]: null },
        { onSuccess: () => { close(); onError(null); }, onError: (e) => onError(e.message) },
      );
    } else if (state.value) {
      patchSecrets(
        { [name]: state.value },
        { onSuccess: () => { close(); onError(null); }, onError: (e) => onError(e.message) },
      );
    } else if (editing !== null) {
      // empty value on an edit keeps the stored value — close quietly
      close();
    }
  }, [name, state.value, editingName, patchSecrets, close, onError]);

  const deleteSecret = useCallback(
    (secretName: string) => {
      patchSecrets({ [secretName]: null }, {
        onSuccess: () => onError(null),
        onError: (e) => onError(e.message),
      });
    },
    [patchSecrets, onError],
  );

  /** allowlist textarea re-keys when the saved list changes (key-reset) */
  const allowlistKey = settings.http_allowlist?.join("\n") ?? "";

  return (
    <section className="mb-8">
      <SectionHeading icon={<KeyRound size={14} />}>Custom nodes</SectionHeading>
      <Card className="p-4 grid gap-4">
        <div>
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="text-[13px] font-medium">Secrets</div>
            <Button size="sm" variant="outline" onClick={openAdd}>
              <Plus size={13} /> Add secret
            </Button>
          </div>
          {secrets.length === 0 ? (
            <p className="text-muted-foreground text-[12px]">
              No secrets set yet — http nodes can&apos;t interpolate <code className="font-mono">{SECRETS_USAGE}</code> values.
            </p>
          ) : (
            <div className="grid gap-2 content-start">
              {secrets.map((secretName) => (
                <SecretRow
                  key={secretName}
                  name={secretName}
                  pending={isPending}
                  onEdit={openEdit}
                  onDelete={deleteSecret}
                />
              ))}
            </div>
          )}
          <p className="text-muted-foreground text-[12px] mt-2">
            Referenced as <code className="font-mono">{SECRETS_USAGE}</code> in http node
            URLs / headers / bodies.
          </p>
        </div>

        <div className="border-t border-border pt-4">
          <HttpAllowlist
            key={allowlistKey}
            initial={settings.http_allowlist ?? []}
            onError={onError}
          />
        </div>
      </Card>

      <SecretModal
        open={editorOpen}
        onClose={close}
        title={editingName ? SECRET_MODAL_TITLE.EDIT : SECRET_MODAL_TITLE.ADD}
        submitLabel={editingName ? "Save changes" : "Add secret"}
        canSubmit={canSubmit}
        submitting={isPending}
        onSubmit={submit}
      >
        <SecretForm state={state} editingName={editingName} setField={setField} />
      </SecretModal>
    </section>
  );
}
