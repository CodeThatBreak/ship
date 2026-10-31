/** Status bucket style: success when terminal, info while running, blocked. */
export const statusStyle = (status: string): { className: string; label: string } => {
  const s = (status ?? "").toLowerCase();
  if (/done|closed|resolved|complete/.test(s))
    return { className: "bg-success/10 text-success", label: "done" };
  if (/active|progress|review|testing/.test(s))
    return { className: "bg-info/10 text-info", label: "active" };
  if (/block|hold/.test(s))
    return { className: "bg-destructive/10 text-destructive", label: "blocked" };
  return { className: "bg-zinc-500/10 text-zinc-400", label: "todo" };
};
