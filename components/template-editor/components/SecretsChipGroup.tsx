"use client";
/**
 * The http node's secrets chip group (Phase 6), extracted from
 * ConfigFieldRow.tsx: the configured secret names (GET /api/settings — names
 * only, values never leave the server) as chips that insert
 * `{{secrets.NAME}}` into the field. Empty state points to the Settings page
 * where secrets are managed.
 */
export function SecretsChipGroup({
  names,
  onInsert,
}: {
  names: string[];
  onInsert: (ref: string) => void;
}) {
  return (
    <div className="flex gap-1 flex-wrap items-center">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        secrets
      </span>
      {names.length === 0 ? (
        <span className="text-[11px] text-muted-foreground">
          none configured — add secrets under Settings
        </span>
      ) : (
        names.map((n) => (
          <button
            key={n}
            type="button"
            title={`Insert {{secrets.${n}}}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onInsert(`{{secrets.${n}}}`)}
            className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-mono text-muted-foreground transition-colors hover:border-info/50 hover:text-foreground"
          >
            {n}
          </button>
        ))
      )}
    </div>
  );
}
