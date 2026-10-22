/**
 * Process-wide singleton registry.
 *
 * Under `next dev`, route handlers can be bundled into separate module graphs,
 * so a module-scope `new Foo()` is NOT guaranteed to be one instance per
 * process — the events-poll bundle and the action-route bundle each get their
 * own copy. For stateful services (in-memory run handles, throttle maps,
 * interval flags) that divergence caused reconcile to see an empty run-handle
 * map and fail healthy runs as "server restarted".
 *
 * Pinning the instance on `globalThis` makes it one-per-process regardless of
 * how many module graphs import it.
 */
export function processSingleton<T>(key: string, create: () => T): T {
  const g = globalThis as Record<PropertyKey, unknown>;
  const sym = Symbol.for(`devflow.singleton.${key}`);
  if (g[sym] == null) g[sym] = create();
  return g[sym] as T;
}
