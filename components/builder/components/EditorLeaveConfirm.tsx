"use client";
/**
 * The "leave with unsaved changes?" confirm on the back link (shown while
 * the draft is dirty): keeping edits returns, leaving clears the beforeunload
 * guard and navigates back to the gallery.
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface EditorLeaveConfirmProps {
  open: boolean;
  onKeep: () => void;
  onLeave: () => void;
}

export function EditorLeaveConfirm({ open, onKeep, onLeave }: EditorLeaveConfirmProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onKeep(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leave with unsaved changes?</DialogTitle>
          <DialogDescription>
            Nodes and connections you added are only kept when you Save. Your
            last saved version stays as it is.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onKeep}>
            Keep editing
          </Button>
          <Button variant="destructive" onClick={onLeave}>
            Leave without saving
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
