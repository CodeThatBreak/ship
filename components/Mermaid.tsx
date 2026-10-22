"use client";
import { useEffect, useState } from "react";

let ready: Promise<typeof import("mermaid").default> | null = null;
let seq = 0;

/** Lazy-load mermaid (big bundle) and initialize it once with the app theme. */
function loadMermaid() {
  ready ??= import("mermaid").then((m) => {
    m.default.initialize({
      startOnLoad: false,
      securityLevel: "strict", // sanitize labels; content comes from the agent
      theme: "base",
      themeVariables: {
        background: "#0d1118",
        primaryColor: "#1a2432",
        primaryBorderColor: "#2c3e5d",
        primaryTextColor: "#e6edf5",
        secondaryColor: "#151d2a",
        tertiaryColor: "#0d1118",
        lineColor: "#64748b",
        textColor: "#9aa7b8",
        edgeLabelBackground: "#111722",
        clusterBkg: "#111722",
        clusterBorder: "#1f2a3a",
        fontFamily: 'Inter, -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif',
        fontSize: "13px",
      },
      flowchart: { htmlLabels: false, useMaxWidth: true },
    });
    return m.default;
  });
  return ready;
}

/** Renders a ```mermaid fenced block as an SVG diagram; falls back to the raw code on parse errors. */
export default function Mermaid({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const id = `mmd-${Date.now()}-${seq++}`;
    loadMermaid()
      .then((mermaid) => mermaid.render(id, code))
      .then(({ svg }) => {
        if (live) setSvg(svg);
      })
      .catch((e) => {
        // on failure mermaid leaves its temp/error elements in the DOM — clean them up
        document.getElementById(`d${id}`)?.remove();
        document.getElementById(id)?.remove();
        if (live) setErr(String(e?.message ?? e));
      });
    return () => {
      live = false;
    };
  }, [code]);

  if (err) {
    return (
      <div>
        <p className="text-red text-xs mb-1.5">Mermaid diagram failed to render: {err}</p>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  }
  if (!svg) return <p className="text-muted text-xs py-3">Rendering diagram…</p>;
  return (
    <div
      className="my-2 overflow-x-auto rounded-[10px] border border-border-soft bg-bg-soft px-3 py-2.5 [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
