"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Modal } from "./Modal";

const FORM_MODAL_WIDTH = {
  sm: "max-w-[420px]! sm:max-w-[420px]!",
  md: "max-w-[460px]! sm:max-w-[460px]!",
  lg: "max-w-[560px]! sm:max-w-[560px]!",
} as const;

export type FormModalWidth = keyof typeof FORM_MODAL_WIDTH;

/** Cancel + primary submit footer shared by settings connect/repo/secret modals. */
export const FormModal = ({
  open,
  onClose,
  title,
  width = "sm",
  submitLabel,
  submitIcon,
  canSubmit,
  submitting,
  onSubmit,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  width?: FormModalWidth;
  submitLabel: string;
  submitIcon: ReactNode;
  canSubmit: boolean;
  submitting?: boolean;
  onSubmit: () => void;
  children: ReactNode;
}) => {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      className={FORM_MODAL_WIDTH[width]}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={submitting || !canSubmit}>
            {submitting ? <Spinner /> : submitIcon} {submitLabel}
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5">{children}</div>
    </Modal>
  );
};
