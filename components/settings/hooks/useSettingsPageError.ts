"use client";
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Scoped action error for one settings sub-route — cleared on navigation so
 * a failure on General does not stick on Integrations (CR-152).
 */
export const useSettingsPageError = () => {
  const pathname = usePathname();
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setActionError(null);
  }, [pathname]);

  const reportError = useCallback((message: string | null) => {
    setActionError(message);
  }, []);

  const clearError = useCallback(() => {
    setActionError(null);
  }, []);

  return { actionError, reportError, clearError };
};
