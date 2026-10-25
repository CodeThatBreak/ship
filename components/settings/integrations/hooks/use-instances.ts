"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InstanceRow, TestResult } from "../types";
import type { InstanceSurface } from "../constants";
import { readError } from "../../queries";
import { FAILED_ACTION } from "@/constants/api";
import { queryKeys } from "@/constants/query-keys";
import {
  dropPersistedTestResult, testResultKey, type TestStore,
} from "./use-test-results";

/**
 * Server state for the integration instance endpoints
 * (/api/host-instances/<kind>, /api/task-instances/<kind>). Every operation
 * is a useQuery/useMutation built on thin fetch wrappers; mutations
 * invalidate the affected key (and clean up persisted test results) instead
 * of imperatively refetching. Per-instance pending state falls out of
 * `isPending` + `variables` — no `testing: string | null` state.
 */

// ── fetch wrappers (throw on failure so onError gets the server message) ────

function instancesUrl(surface: InstanceSurface, kind: string, id?: string): string {
  return `/api/${surface}-instances/${kind}${id ? `/${id}` : ""}`;
}

/** List read — throws on failure so the tab can render an error state with retry. */
async function fetchInstances(surface: InstanceSurface, kind: string): Promise<InstanceRow[]> {
  const res = await fetch(instancesUrl(surface, kind));
  if (!res.ok) throw await readError(res, FAILED_ACTION.LOAD);
  const body = (await res.json().catch(() => ({}))) as { instances?: InstanceRow[] };
  return body.instances ?? [];
}

async function createInstance(
  surface: InstanceSurface,
  kind: string,
  payload: Record<string, unknown>,
): Promise<InstanceRow> {
  const res = await fetch(instancesUrl(surface, kind), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res, FAILED_ACTION.SAVE);
  const body = (await res.json().catch(() => ({}))) as { instance?: InstanceRow };
  return body.instance ?? (null as unknown as InstanceRow);
}

async function deleteInstance(surface: InstanceSurface, kind: string, id: string): Promise<void> {
  const res = await fetch(instancesUrl(surface, kind, id), { method: "DELETE" });
  if (!res.ok) throw await readError(res, FAILED_ACTION.REMOVE);
}

/**
 * POST the per-instance test call and normalize the response into a strict
 * `{ ok, detail }` — error payloads and network failures both come back as
 * `ok: false`, so a card can only ever render a truthful badge.
 */
async function callTestInstance(
  surface: InstanceSurface,
  kind: string,
  id: string,
): Promise<TestResult> {
  const res = await fetch(instancesUrl(surface, kind, id), { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as Partial<TestResult> & { error?: string };
  if (!res.ok || typeof body.ok !== "boolean") {
    return { ok: false, detail: body.error ?? `connection test failed (${res.status})` };
  }
  return { ok: body.ok, detail: body.detail ?? "" };
}

// ── hooks ───────────────────────────────────────────────────────────────────

const EMPTY_INSTANCES: InstanceRow[] = [];

/** Cached instance list for one provider kind. */
export function useInstances(surface: InstanceSurface, kind: string) {
  const query = useQuery({
    queryKey: queryKeys.integrations.instances(surface, kind),
    queryFn: () => fetchInstances(surface, kind),
  });
  return {
    instances: query.data ?? EMPTY_INSTANCES,
    isPending: query.isPending,
    isError: query.isError,
    refetch: () => query.refetch(),
  };
}

export function useConnectInstance(surface: InstanceSurface, kind: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => createInstance(surface, kind, payload),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.integrations.instances(surface, kind) }),
  });
}

/** Delete an instance and drop its persisted connection-test badge. */
export function useRemoveInstance(surface: InstanceSurface, kind: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteInstance(surface, kind, id),
    onSuccess: (_data, id) => {
      dropPersistedTestResult(kind, id);
      queryClient.setQueryData<TestStore>(queryKeys.integrations.testResults, (prev = {}) => {
        const { [testResultKey(kind, id)]: _dropped, ...rest } = prev;
        return rest;
      });
      return queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.instances(surface, kind),
      });
    },
  });
}

/** Run the per-instance connection test (persisting the result is the caller's job). */
export function useTestInstance(surface: InstanceSurface, kind: string) {
  return useMutation({
    mutationFn: (id: string) => callTestInstance(surface, kind, id),
  });
}
