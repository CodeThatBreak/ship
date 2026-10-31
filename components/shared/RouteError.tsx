"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, XCircle } from "lucide-react";
import { Alert, AlertAction } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export type RouteErrorShell = "root" | "workspace" | "page" | "fixed";

export type RouteErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
  message: string;
  logTag: string;
  shell?: RouteErrorShell;
  back?: { href: string; label: string };
};

const SHELL_CLASS: Record<RouteErrorShell, string> = {
  root: "grid min-h-screen place-items-center p-8",
  workspace: "grid min-h-[50vh] place-items-center",
  page: "grid min-h-screen place-items-center p-8",
  fixed: "fixed inset-0 grid place-items-center p-8",
};

export const RouteError = ({
  error,
  reset,
  message,
  logTag,
  shell = "workspace",
  back,
}: RouteErrorProps) => {
  useEffect(() => {
    console.error(`[${logTag}] uncaught error`, error);
  }, [error, logTag]);

  const body = (
    <Alert variant="destructive" className="max-w-[640px]">
      <XCircle size={16} />
      <span className="flex-1">
        {message}
        {error.digest && (
          <span className="block text-[11px] opacity-70">ref: {error.digest}</span>
        )}
      </span>
      <AlertAction>
        {back && (
          <Button size="sm" variant="outline" render={<Link href={back.href} />}>
            <ArrowLeft size={13} /> {back.label}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={reset}>
          Retry
        </Button>
      </AlertAction>
    </Alert>
  );

  if (shell === "root") {
    return <div className={SHELL_CLASS.root}>{body}</div>;
  }
  if (shell === "workspace") {
    return <div className={SHELL_CLASS.workspace}>{body}</div>;
  }
  return <main className={SHELL_CLASS[shell]}>{body}</main>;
};
