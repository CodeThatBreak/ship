/** One connected integration instance as returned by the instance endpoints. */
export type InstanceRow = {
  id: string;
  name: string | null;
  baseUrl: string;
  email?: string;
  tokenMasked: string;
};

/** Result of a connection-test call — ok/detail summary only, never secrets. */
export type TestResult = { ok: boolean; detail: string };

/** Shared tab props — the Connect button lives next to the tabs (page-level). */
export type TabProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onError: (e: string | null) => void;
};
