"use client";
import { KeyRound } from "lucide-react";
import { FormModal } from "@/components/shared";

/** Modal chrome for the add/edit secret form. */
export const SecretModal = ({
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
}) => {
  return (
    <FormModal
      open={open}
      onClose={onClose}
      title={title}
      width="md"
      submitLabel={submitLabel}
      submitIcon={<KeyRound size={13} />}
      canSubmit={canSubmit}
      submitting={submitting}
      onSubmit={onSubmit}
    >
      {children}
    </FormModal>
  );
};
