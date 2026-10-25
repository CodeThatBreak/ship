import type { Settings } from "../context";
import { LOCAL_AGENT } from "./constants";

/** One connected integration instance as returned by the instance endpoints. */
export type InstanceRow = {
  id: string;
  name: string | null;
  baseUrl: string;
  email?: string;
  tokenMasked: string;
};

/** Editable local-run execution settings shown on the harness card
 *  (shape of GET /api/settings → local_agent). */
export type LocalAgentOptions = Settings["local_agent"];

/** PATCH field names that can be written through { local_agent: {...} }. */
export type LocalAgentField =
  (typeof LOCAL_AGENT.FIELD)[keyof typeof LOCAL_AGENT.FIELD];

/** Result of a connection-test call — ok/detail summary only, never secrets. */
export type TestResult = { ok: boolean; detail: string };

/** Shared tab props — the Connect button lives next to the tabs (page-level). */
export type TabProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onError: (e: string | null) => void;
};
