/**
 * Transport helpers for the query hooks in this directory — fetch + parse with
 * a single { error } HTTP-error contract so hook files stay fetch-free.
 * (Naming exception: a module, not a hook, so it isn't `use-<name>.ts`.)
 */
export type JsonErrorBody = { error?: string };

/** fetch + parse JSON, throwing on transport or HTTP errors. */
export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw await errorOf(res);
  return (await res.json()) as T;
}

/** POST JSON, parse and return the payload, throwing on transport or HTTP errors. */
export async function postJson<T>(url: string, body: string): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) throw await errorOf(res);
  return (await res.json()) as T;
}

/** PATCH JSON, parse and return the payload, throwing on transport or HTTP errors. */
export async function patchJson<T>(url: string, body: string): Promise<T> {
  const res = await fetch(url, {
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

/** Build an Error carrying the server's `error` message (or the status). */
async function errorOf(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as JsonErrorBody;
  return new Error(body.error ?? `Request failed (${res.status})`);
}
