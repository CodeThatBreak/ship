/**
 * Transport helpers for the query hooks in this directory — fetch + parse with
 * a single { error } HTTP-error contract so hook files stay fetch-free.
 * (Naming exception: a module, not a hook, so it isn't `use-<name>.ts`.)
 */
import { apiFetch, withLocalApiAuth } from "@/hooks/localApiToken";

export type JsonErrorBody = { error?: string; code?: string };

export { apiFetch, withLocalApiAuth };

/** An HTTP failure carrying the body's typed `code` when the API answers with
 *  one (step 06: a skipped duplicate trigger answers 409 `{ code }` with no
 *  `error` field) — UI layers branch on the code, not the message text. */
export class HttpError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, options: { status: number; code?: string }) {
    super(message);
    this.name = "HttpError";
    this.status = options.status;
    this.code = options.code;
  }
}

/** fetch + parse JSON, throwing on transport or HTTP errors. */
export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw await errorOf(res);
  return (await res.json()) as T;
}

/** POST JSON, parse and return the payload, throwing on transport or HTTP errors. */
export async function postJson<T>(url: string, body: string): Promise<T> {
  const res = await apiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) throw await errorOf(res);
  return (await res.json()) as T;
}

/** PATCH JSON, parse and return the payload, throwing on transport or HTTP errors. */
export async function patchJson<T>(url: string, body: string): Promise<T> {
  const res = await apiFetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) throw await errorOf(res);
  return (await res.json()) as T;
}

/** A mutation/query failure's message for an `error`-slot UI prop — null when
 *  there is no failure at all. Guard clauses, so callers stay single-level. */
export function errorMessageOf(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (error != null) return String(error);
  return null;
}

/** A mutation/query failure's typed `code` from the response body — null when
 *  the failure carried none (transport error, or a body with only `error`). */
export function errorCodeOf(error: unknown): string | null {
  if (error instanceof HttpError) return error.code ?? null;
  return null;
}

/** Build the Error for a failed response, carrying the body's `error` message
 *  (or the status) plus its typed `code` when the body declares one. */
async function errorOf(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as JsonErrorBody;
  return new HttpError(body.error ?? `Request failed (${res.status})`, {
    status: res.status,
    code: body.code,
  });
}
