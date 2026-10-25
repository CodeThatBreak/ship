"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import type { TestResult } from "../types";

/**
 * Persisted connection-test results per instance (localStorage, keyed
 * `${provider}:${instanceId}`). The server test call decides ok — tokens are
 * never written here, only the ok/detail summary, so each card's badge
 * survives a refresh. Backed by TanStack Query: reads hydrate through the
 * cache (client-side only, so SSR markup stays stable) and writes patch the
 * cache directly instead of juggling per-instance useState records.
 */

const STORE_KEY = "devflow.integration-tests";

type TestStore = Record<string, TestResult>;
export type { TestStore };

/** Stable empty-map reference so consumers don't churn on loading renders. */
const EMPTY_TEST_RESULTS: TestStore = {};

/** Composite key matching what the endpoints persist (`provider:id`). */
export function testResultKey(provider: string, id: string): string {
  return `${provider}:${id}`;
}

function readTestStore(): TestStore {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORE_KEY) ?? "{}") as TestStore;
  } catch {
    return {};
  }
}

function writeTestStore(store: TestStore): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // storage unavailable (private mode, quota) — badges just won't persist
  }
}

function persistTestResult(provider: string, id: string, result: TestResult): void {
  writeTestStore({ ...readTestStore(), [testResultKey(provider, id)]: result });
}

/** Remove an instance's persisted result (called on delete). */
export function dropPersistedTestResult(provider: string, id: string): void {
  const store = readTestStore();
  if (!(testResultKey(provider, id) in store)) return;
  delete store[testResultKey(provider, id)];
  writeTestStore(store);
}

/** All persisted test results, keyed `provider:id` ({} until first client render). */
export function useTestResults(): TestStore {
  const query = useQuery({
    queryKey: queryKeys.integrations.testResults,
    queryFn: readTestStore,
    // localStorage never changes behind our back — writes go through saveTest
    staleTime: Number.POSITIVE_INFINITY,
  });
  return query.data ?? EMPTY_TEST_RESULTS;
}

/** Persist a fresh test outcome and mirror it into the query cache. */
export function useRecordTestResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ provider, id, result }: { provider: string; id: string; result: TestResult }) => {
      persistTestResult(provider, id, result);
      return result;
    },
    onSuccess: (result, { provider, id }) => {
      queryClient.setQueryData<TestStore>(queryKeys.integrations.testResults, (prev = {}) => ({
        ...prev,
        [testResultKey(provider, id)]: result,
      }));
    },
  });
}
