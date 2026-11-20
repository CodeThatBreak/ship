import "server-only";

/** Bounded-concurrency map — runs `fn` over `items` with at most `limit`
 *  workers, preserving input order in the result. Used to keep the per-repo
 *  git probes of the worktree status sweep from stampeding the host. */
export const mapPool = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
};
