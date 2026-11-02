"use client";
/**
 * The catalog's create/configure dialog: identity + the kind's full
 * definition, boilerplate-seeded so a new node runs as-is (authors remap
 * inputs and tweak knobs instead of starting from a blank def). Owns the
 * form draft, the schema-driven contract fetch (`useNodeSchemaContract`), the
 * http secret-names chip query and the save — validation problems stay in
 * the dialog, next to the definition they point at.
 */
import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { NODE_KIND_DESCRIPTIONS, type NodeTemplateKind, boilerplateFor } from "@/components/templateEditor/boilerplate";
import { queryKeys } from "@/constants/queryKeys";
import { apiFetch } from "@/hooks/localApiToken";
import { settingsQueryOptions } from "@/components/settings/queries";
import { isNodeKind } from "../constants";
import { useNodeSchemaContract } from "../hooks/useNodeSchemaContract";
import type { NodeFormState, NodeRow } from "../types";
import { NodeFormFields } from "./NodeFormFields";

/** A fresh create form: boilerplate definition + boilerplate description,
 *  so the node runs (and reads) as-is out of the box. */
function emptyForm(): NodeFormState {
  return {
    name: "",
    description: NODE_KIND_DESCRIPTIONS.agent,
    kind: "agent",
    config: boilerplateFor("agent"),
  };
}

export function NodeConfigureDialog({
  node,
  onClose,
}: {
  /** the stored row being configured — null = a create */
  node: NodeRow | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState<NodeFormState>(() =>
    node
      ? {
          name: node.name,
          description: node.description ?? "",
          kind: isNodeKind(node.kind) ? node.kind : "agent",
          // the stored definition round-trips untouched (including the
          // `_ts` companions the schema boxes authored with)
          config: structuredClone(node.config ?? {}),
        }
      : emptyForm(),
  );
  const [formError, setFormError] = useState<string | null>(null);
  const onPatch = useCallback(
    (patch: Partial<NodeFormState>) => setForm((f) => ({ ...f, ...patch })),
    [],
  );

  // the contract rides the dialog's kind + current definition (the drawer's
  // draft pattern); the http kinds' {{secrets.NAME}} chips need the secret
  // names
  const contract = useNodeSchemaContract(form.kind, form.config);
  const { data: settingsData } = useQuery({
    ...settingsQueryOptions(),
    enabled: form.kind === "http",
  });
  const secretNames = form.kind === "http" ? (settingsData?.secrets ?? null) : null;

  /** A kind switch on create re-seeds the definition — boilerplate per kind,
   *  never a mixed leftover of the previous kind's shape. The description
   *  follows too, unless the author already customized it. */
  const switchKind = useCallback((kind: NodeTemplateKind) => {
    setForm((f) => ({
      ...f,
      kind,
      config: boilerplateFor(kind),
      description:
        !f.description || Object.values(NODE_KIND_DESCRIPTIONS).includes(f.description)
          ? NODE_KIND_DESCRIPTIONS[kind]
          : f.description,
    }));
  }, []);

  const queryClient = useQueryClient();
  const saveMutation = useMutation({
    /** Create or save — the server re-validates the whole definition through
     *  the kind's zod schema; every field of it was editable here. */
    mutationFn: () => {
      const body = JSON.stringify({
        name: form.name,
        description: form.description || null,
        kind: form.kind,
        config: form.config,
      });
      return apiFetch(node ? `/api/node-templates/${node.id}` : "/api/node-templates", {
        method: node ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }).then(async (r) => {
        const payload = (await r.json().catch(() => null)) as { error?: string } | null;
        if (!r.ok || payload?.error) {
          throw new Error(payload?.error ?? `Request failed (${r.status})`);
        }
        return payload;
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.nodeTemplates });
      onClose();
    },
    onError: (e) => setFormError(e.message),
  });

  const save = () => {
    if (!form.name.trim()) {
      setFormError("name is required");
      return;
    }
    saveMutation.mutate();
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{node ? "Configure node" : "New node"}</DialogTitle>
        </DialogHeader>
        {formError && <Alert variant="destructive">{formError}</Alert>}
        <NodeFormFields
          form={form}
          hasId={node != null}
          onPatch={onPatch}
          onKindChange={switchKind}
          contract={contract}
          secretNames={secretNames}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <Spinner /> : <Plus size={13} />}
            {node ? "Save node" : "Create node"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
