/**
 * Shared formatting helpers for run/tool meta rows (duration · tokens · cost).
 * Moved out of the old `components/ActivityFeed.tsx` when the activity feed
 * merged into the unified chat panel.
 */

export function fmtDuration(ms?: number): string {
  if (ms == null) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function fmtTokens(n?: number): string {
  if (n == null || !n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M tok`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k tok`;
  return `${n} tok`;
}

/** Short date (e.g. "Oct 25") for table "Updated"-style columns; year is
 *  included when the date isn't in the current year. Empty for bad input. */
export function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-US", opts);
}

export function fmtCost(dollars?: number): string {
  if (dollars == null) return "";
  return `$${dollars.toFixed(2)}`;
}

export function wordCount(s: string): string {
  const n = s.trim().split(/\s+/).filter(Boolean).length;
  return n.toLocaleString();
}

/** Best-effort one-line summary of a tool invocation's arguments. */
export function summarizeArgs(name: string, args?: string): string {
  if (!args) return "";
  try {
    const a = JSON.parse(args);
    const n = name.toLowerCase();
    const cand = a.path ?? a.file ?? a.file_path ?? a.filename ?? a.command ?? a.cmd ?? a.query ?? a.url ?? a.pattern;
    if (typeof cand === "string") return cand.length > 60 ? cand.slice(0, 57) + "…" : cand;
    const keys = Object.keys(a).slice(0, 3).join(", ");
    return keys.length > 60 ? keys.slice(0, 57) + "…" : keys;
  } catch {
    return args.length > 60 ? args.slice(0, 57) + "…" : args;
  }
}

export function prettyJson(json: string): string {
  try { return JSON.stringify(JSON.parse(json), null, 2); } catch { return json; }
}

export function truncateChars(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + `\n… (${(s.length - n).toLocaleString()} more chars)` : s;
}
