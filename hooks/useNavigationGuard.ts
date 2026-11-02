"use client";

import { useEffect, useRef } from "react";

const HISTORY_SENTINEL = { devflowEditorUnsaved: true as const };

const isSameDocumentHref = (href: string): boolean => {
  if (href.startsWith("#")) return true;
  try {
    const resolved = new URL(href, window.location.href);
    return (
      resolved.origin === window.location.origin &&
      resolved.pathname === window.location.pathname &&
      resolved.search === window.location.search
    );
  } catch {
    return false;
  }
};

const isInAppHref = (href: string): boolean => {
  if (href.startsWith("/") && !href.startsWith("//")) return true;
  try {
    return new URL(href, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
};

export type BlockedNavigation =
  | { kind: "history-back" }
  | { kind: "link"; href: string };

export type NavigationGuardOptions = {
  onBlocked: (target: BlockedNavigation) => void;
};

/**
 * While `dirty`, intercept browser Back/Forward (popstate) and in-app link
 * clicks so the host can confirm before discarding the draft.
 */
export const useNavigationGuard = (
  dirty: boolean,
  options: NavigationGuardOptions,
): void => {
  const onBlockedRef = useRef(options.onBlocked);
  onBlockedRef.current = options.onBlocked;

  useEffect(() => {
    if (!dirty) return;

    window.history.pushState(HISTORY_SENTINEL, "", window.location.href);

    const onPopState = () => {
      window.history.pushState(HISTORY_SENTINEL, "", window.location.href);
      onBlockedRef.current({ kind: "history-back" });
    };

    const onDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href || !isInAppHref(href)) return;
      if (isSameDocumentHref(href)) return;
      event.preventDefault();
      event.stopPropagation();
      onBlockedRef.current({ kind: "link", href });
    };

    window.addEventListener("popstate", onPopState);
    document.addEventListener("click", onDocumentClick, true);
    return () => {
      window.removeEventListener("popstate", onPopState);
      document.removeEventListener("click", onDocumentClick, true);
    };
  }, [dirty]);
};
