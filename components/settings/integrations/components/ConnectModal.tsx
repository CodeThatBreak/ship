"use client";
import { Link2 } from "lucide-react";
import { FormModal } from "@/components/shared";

/** Connect integration modal — stepped fields come from the tab body. */
export const ConnectModal = ({
  open, onClose, title, children, canSubmit, submitting, onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  canSubmit: boolean;
  submitting?: boolean;
  onSubmit: () => void;
}) => {
  return (
    <FormModal
      open={open}
      onClose={onClose}
      title={title}
      width="sm"
      submitLabel="Connect"
      submitIcon={<Link2 size={13} />}
      canSubmit={canSubmit}
      submitting={submitting}
      onSubmit={onSubmit}
    >
      {children}
    </FormModal>
  );
};
