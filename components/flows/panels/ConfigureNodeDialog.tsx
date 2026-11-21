"use client";
/**
 * The node's Configure dialog (task 05): edits THIS flow's config snapshot
 * (`nodes.config`) for a not-yet-started node — the engine accepts the edit
 * only while the node is `pending`/`failed` (everything else rejects with a
 * 409) and the next run re-reads the edited snapshot. The draft is the
 * snapshot's JSON: the def's typed knobs are validated server-side by
 * `parseRunConfig`, so a bad value surfaces as the server's message next to
 * the draft instead of being guessed at here.
 */
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { errorMessageOf } from "@/hooks/fetchJson";
import { FLOW_ACTION } from "@/constants/flow";
import type { Node } from "@/types/flow";
import { useFlowMutation } from "../mutations/useFlowMutation";
import { panelTitle } from "./shared";

export const ConfigureNodeDialog = ({
  flowId,
  node,
  onClose,
}: {
  flowId: string;
  node: Node;
  onClose: () => void;
}) => {
  const [draft, setDraft] = useState(() => JSON.stringify(node.config ?? {}, null, 2));
  const [draftError, setDraftError] = useState<string | null>(null);
  const mutation = useFlowMutation({ flowId });

  const save = async () => {
    let config: unknown;
    try {
      config = JSON.parse(draft);
    } catch {
      setDraftError("config is not valid JSON");
      return;
    }
    if (config == null || typeof config !== "object" || Array.isArray(config)) {
      setDraftError("config must be a JSON object");
      return;
    }
    setDraftError(null);
    try {
      await mutation.mutateAsync({ action: FLOW_ACTION.SET_NODE_CONFIG, nodeKey: node.node_key, config });
      onClose();
    } catch {
      // the failure surfaces on `mutation.error` below, next to the draft
    }
  };

  const serverError = errorMessageOf(mutation.error);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Configure {panelTitle(node)}</DialogTitle>
        </DialogHeader>
        <p className="text-[12.5px] text-muted-foreground m-0">
          Edits this flow&apos;s config snapshot — the node picks the change up on its next run.
        </p>
        {(draftError || serverError) && <Alert variant="destructive">{draftError ?? serverError}</Alert>}
        <textarea
          aria-label="Node config snapshot"
          className="min-h-[240px] w-full rounded-md border bg-background p-2.5 font-mono text-[12.5px]"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={mutation.isPending}>
            {mutation.isPending ? <Spinner /> : null}
            Save config
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};