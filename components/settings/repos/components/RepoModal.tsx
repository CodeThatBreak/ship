"use client";
import { FolderGit2 } from "lucide-react";
import { FormModal } from "@/components/shared";

/** Modal chrome for the add/edit repo form. */
export const RepoModal = ({
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
      width="lg"
      submitLabel={submitLabel}
      submitIcon={<FolderGit2 size={13} />}
      canSubmit={canSubmit}
      submitting={submitting}
      onSubmit={onSubmit}
    >
      {children}
    </FormModal>
  );
};
