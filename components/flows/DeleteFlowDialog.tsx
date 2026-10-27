"use client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import { Trash2 } from "lucide-react";
import type { FlowSummary } from "@/types/flows";

/**
 * Delete confirm: styled AlertDialog (not the native confirm). The destructive
 * action belongs to the caller — this dialog is display-only.
 */
export function DeleteFlowDialog({
  flow,
  busy,
  onConfirm,
  onClose,
}: {
  flow: FlowSummary | null;
  /** the delete mutation is in flight for this very flow */
  busy: boolean;
  onConfirm: (flow: FlowSummary) => void;
  onClose: () => void;
}) {
  return (
    <AlertDialog open={flow != null} onOpenChange={(v) => { if (!v) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete flow for “{flow?.task_key}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The whole flow is removed: nodes, runs, comments, events and any
            fanned-out step sub-flows. The local worktree (if any) is deleted
            too. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => flow && onConfirm(flow)}
            disabled={busy}
          >
            {busy ? <Spinner /> : <Trash2 size={13} />} Delete flow
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
