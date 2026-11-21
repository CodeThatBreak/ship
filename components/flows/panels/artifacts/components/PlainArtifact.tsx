"use client";

/** The themed `<pre>` body shared by the JSON renderer and the unknown-kind
 *  fallback — one markup source, so the two can never drift. */
export const PlainArtifact = ({ content }: { content: string }) => (
  <pre className="overflow-y-auto whitespace-pre-wrap bg-background border border-border rounded-lg p-3.5 text-[12.5px] font-mono">
    {content}
  </pre>
);
