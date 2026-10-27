"use client";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";

/** Modal chrome shared by every connect modal: Cancel + Connect footer, with
 *  the submit button disabled while a request is in flight or the form is
 *  still incomplete. Tabs only supply the stepped fields. */
export function ConnectModal({
  open, onClose, title, children, canSubmit, submitting, onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
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
      className="max-w-[420px]! sm:max-w-[420px]!"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onSubmit} disabled={submitting || !canSubmit}>
            {submitting ? <Spinner /> : <Link2 size={13} />} Connect
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5">{children}</div>
    </Modal>
  );
}
