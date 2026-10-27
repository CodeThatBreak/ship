"use client";
/**
 * Generic destructive-confirm dialog (the styled AlertDialog that replaced
 * the native confirm()): a title, an explanation, an explicit Cancel and a
 * busy-aware confirm action. Drop-in for any list row's Delete action —
 * owns no data, everything arrives through props.
 */
import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
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

export function ConfirmDeleteDialog({
  open,
  onClose,
  title,
  description,
  busy = false,
  onConfirm,
  confirmLabel,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: ReactNode;
  /** true while the destructive request is in flight (confirm is disabled) */
  busy?: boolean;
  onConfirm: () => void;
  confirmLabel: string;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? <Spinner /> : <Trash2 size={13} />} {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
