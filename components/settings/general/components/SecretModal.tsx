"use client";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/shared";
import { Spinner } from "@/components/ui/spinner";

/** Modal chrome for the add/edit secret form: Cancel + submit footer, with the
 *  submit button disabled while a request is in flight or the fields aren't
 *  valid yet. The body is the secret form itself. (Mirrors RepoModal.) */
export function SecretModal({
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
      className="max-w-[460px]! sm:max-w-[460px]!"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onSubmit} disabled={submitting || !canSubmit}>
            {submitting ? <Spinner /> : <KeyRound size={13} />} {submitLabel}
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5">{children}</div>
    </Modal>
  );
}
