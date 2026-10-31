"use client";
import { FolderGit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/shared";
import { Spinner } from "@/components/ui/spinner";

/** Modal chrome for the add/edit repo form: Cancel + submit footer, with the
 *  submit button disabled while a request is in flight or required fields are
 *  still missing. The body is the repo form itself. */
export function RepoModal({
  open, onClose, title, submitLabel, children, canSubmit, submitting, onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  submitLabel: string;
  children: React.ReactNode;
  canSubmit: boolean;
  submitting?: boolean;
  onSubmit: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      className="max-w-[560px]! sm:max-w-[560px]!"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onSubmit} disabled={submitting || !canSubmit}>
            {submitting ? <Spinner /> : <FolderGit2 size={13} />} {submitLabel}
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5">{children}</div>
    </Modal>
  );
}
