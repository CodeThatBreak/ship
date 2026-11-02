import "server-only";

/**
 * Minimal in-memory TTL cache for runtime-fetched external data (e.g. live
 * Jira searches). Keyed, per-process, and intentionally tiny — the point is
 * to absorb bursts of identical requests, not to be a real cache layer.
 */
const DEFAULT_MAX_ENTRIES = 500;
/** Drop entries this many TTLs past expiry (stale-on-error reads stay valid briefly). */
const STALE_RETAIN_TTL_MULTIPLIER = 2;

export class TtlCache<V> {
  private entries = new Map<
    string,
    { value: V; storedAt: number; expiresAt: number }
  >();

  constructor(
    readonly ttlMs: number = 60_000,
    private readonly maxEntries: number = DEFAULT_MAX_ENTRIES,
  ) {}

  /** Fresh value, or undefined when absent/expired. */
  get(key: string): V | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (Date.now() >= e.expiresAt) return undefined;
    return e.value;
  }

  /** Entry whether fresh or stale — callers decide what to do with the age. */
  entry(
    key: string,
  ): { value: V; storedAt: number; expiresAt: number; stale: boolean } | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    return { ...e, stale: Date.now() >= e.expiresAt };
  }

  set(key: string, value: V): void {
    const now = Date.now();
    this.sweepExpired(now);
    this.entries.set(key, {
      value,
      storedAt: now,
      expiresAt: now + this.ttlMs,
    });
    this.evictOldestIfOverCap();
  }

  /** Remove entries far past expiry; does not delete still-stale keys used for fallback reads. */
  private sweepExpired(now: number): void {
    const cutoff = now - this.ttlMs * STALE_RETAIN_TTL_MULTIPLIER;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt < cutoff) this.entries.delete(key);
    }
  }

  private evictOldestIfOverCap(): void {
    while (this.entries.size > this.maxEntries) {
      let oldestKey: string | undefined;
      let oldestAt = Infinity;
      for (const [key, entry] of this.entries) {
        if (entry.storedAt < oldestAt) {
          oldestAt = entry.storedAt;
          oldestKey = key;
        }
      }
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
  }

  /** Seconds since the value was stored (0 for a just-set entry). */
  ageSeconds(key: string): number {
    const e = this.entries.get(key);
    if (!e) return 0;
    return Math.max(0, Math.round((Date.now() - e.storedAt) / 1000));
  }

  clear(): void {
    this.entries.clear();
  }
}
