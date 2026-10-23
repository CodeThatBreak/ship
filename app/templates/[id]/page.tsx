"use client";
/**
 * The template editor (§8.3): template meta + trigger, the step-list of nodes
 * (configure / delete / reorder), and the edge editor. Built-in templates are
 * read-only — duplicate from the gallery to customize.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bot,
  LayoutTemplate,
  Lock,
  Plus,
  Save,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import { Alert } from "../../../components/ui/alert";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Spinner } from "../../../components/ui/spinner";
import { Textarea } from "../../../components/ui/textarea";
import { cn } from "../../../lib/utils";
import AddNodeDialog from "../../../components/template-editor/AddNodeDialog";
import NodeConfigurator from "../../../components/template-editor/NodeConfigurator";
import { FLOW_TRIGGER_TYPE } from "../../../components/template-editor/constants";
import type { EditorEdge, EditorNode } from "../../../components/template-editor/types";

type Draft = {
  template: {
    id: string;
    name: string;
    description: string | null;
    version: number;
    is_builtin: boolean;
    trigger: Record<string, unknown>;
  };
  nodes: EditorNode[];
  edges: EditorEdge[];
};

const EDGE_KINDS = ["next", "loop"] as const;

export default function TemplateEditorPage() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [adding, setAdding] = useState(false);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [configuring, setConfiguring] = useState<EditorNode | null>(null);

  const templateId = (() => {
    const seg = typeof location !== "undefined" ? location.pathname.split("/").filter(Boolean) : [];
    return seg.length >= 2 && seg[0] === "templates" ? seg[1] : null;
  })();

  const load = useCallback(async () => {
    setError(null);
    const data = await fetch(`/api/templates/${templateId}`).then((r) => r.json()).catch(() => null);
    if (data?.template) {
      // map the API's snake_case rows onto the EditorNode draft shape
      const d: Draft = {
        template: data.template,
        nodes: (data.nodes ?? []).map((n: any) => ({
          key: n.key,
          nodeTemplateId: n.node_template_id,
          label: n.label,
          overrideLabel: n.label && n.label !== n.catalog_name ? n.label : null,
          trigger: n.trigger ?? { type: "auto" },
          join_mode: n.join_mode ?? "all",
          config: n.config ?? {},
          input_map: n.input_map ?? {},
          kind: n.kind ?? null,
          icon: n.icon ?? null,
          catalog_name: n.catalog_name ?? null,
          is_builtin: Boolean(n.is_builtin),
          description: n.description ?? null,
        })),
        edges: (data.edges ?? []).map((e: any) => ({ from: e.from, to: e.to, kind: e.kind, label: e.label ?? null, condition: e.condition ?? null })),
      };
      setDraft(d);
    } else setError(data?.error ?? "failed to load template");
  }, [templateId]);

  useEffect(() => {
    if (templateId) void load();
  }, [templateId, load]);

  const apply = (next: Draft) => {
    setDraft(next);
    setDirty(true);
    setNotice(null);
  };

  if (!draft) {
    return (
      <main className="p-6">
        {error ? <Alert variant="destructive">{error} — <Link href="/templates" className="underline">back to gallery</Link></Alert> : <Spinner />} Loading…
      </main>
    );
  }

  const readonly = draft.template.is_builtin;

  return (
    <main className="max-w-[900px] mx-auto px-6 py-10">
      <header className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" render={<Link href="/templates" />} className="-ml-1.5 gap-1.5 text-muted-foreground">
          <ArrowLeft className="size-3.5" /> Templates
        </Button>
        <LayoutTemplate size={18} className="text-muted-foreground" />
        <div>
          <h1 className="text-lg font-semibold m-0 leading-tight flex items-center gap-2">
            {draft.template.name}
            {readonly && <Badge className="bg-blue-500/10 text-blue-400"><Lock size={9} className="mr-0.5" />built-in</Badge>}
          </h1>
          <p className="text-muted-foreground text-[12px] m-0">
            v{draft.template.version} · {draft.nodes.length} node{draft.nodes.length === 1 ? "" : "s"} · {draft.edges.length} edge{draft.edges.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex-1" />
        {!readonly && (
          <Button disabled={!dirty || saving || creatingAgent} onClick={() => void save()}>
            {saving ? <Spinner /> : <Save size={13} />} Save{dirty ? "" : "d"}
          </Button>
        )}
      </header>

      {readonly && (
        <Card className="p-3 mb-4 flex items-center gap-2.5 text-[12.5px] text-muted-foreground border-blue-500/25!">
          <Lock size={14} className="text-blue-400" />
          Built-in templates are read-only. Use <Link href="/templates" className="underline">the gallery&apos;s duplicate action</Link> to make an editable copy.
        </Card>
      )}

      {error && <Alert variant="destructive" className="mb-3">{error}</Alert>}
      {notice && <Alert className="mb-3">{notice}</Alert>}

      {/* ── meta ── */}
      <section className="grid gap-3 mb-8">
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground">Template name</label>
          <Input
            value={draft.template.name}
            disabled={readonly}
            onChange={(e) => apply({ ...draft, template: { ...draft.template, name: e.target.value } })}
          />
        </div>
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground">Description</label>
          <Textarea
            value={draft.template.description ?? ""}
            rows={2}
            disabled={readonly}
            onChange={(e) => apply({ ...draft, template: { ...draft.template, description: e.target.value || null } })}
          />
        </div>
        <div className="grid gap-1 max-w-[320px]">
          <label className="text-xs text-muted-foreground">Flow trigger</label>
          <select
            value={String(draft.template.trigger?.type ?? "manual")}
            disabled
            className="bg-card text-foreground border border-border rounded-lg text-[13px] px-3 py-2"
          >
            {Object.entries(FLOW_TRIGGER_TYPE).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground m-0">webhook / schedule wiring lands in Phase 4.</p>
        </div>
      </section>

      {/* ── nodes ── */}
      <section className="mb-8">
        <h2 className="text-[13.5px] font-medium mb-2.5 flex items-center gap-2">
          <Workflow size={14} className="text-muted-foreground" /> Steps
        </h2>
        <div className="grid gap-1.5">
          {draft.nodes.map((n, i) => (
            <Card key={n.key} className="px-3 py-2.5 flex items-center gap-2.5">
              <span className="size-7 shrink-0 grid place-items-center rounded-lg bg-muted">
                {n.kind ? <Bot size={13} className="text-muted-foreground" /> : <Workflow size={13} className="text-muted-foreground" />}
              </span>
              <div className="flex-1 min-w-0 grid gap-0.5">
                <Input
                  value={n.overrideLabel ?? n.catalog_name ?? n.label}
                  disabled={readonly}
                  className="h-auto py-0 border-0 bg-transparent p-0 text-[13px] font-medium shadow-none rounded-none focus-visible:ring-0"
                  onChange={(e) => apply({ ...draft, nodes: draft.nodes.map((p) => (p.key === n.key ? { ...p, overrideLabel: e.target.value } : p)) })}
                />
                <span className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                  <code className="font-mono">{n.key}</code>
                  <Badge variant="outline" className="text-[10px] py-0">{n.kind ?? "builtin"}</Badge>
                  <Badge className="bg-muted text-[10px] py-0">{n.trigger.type}</Badge>
                  {n.join_mode === "any" && <Badge className="bg-amber-500/10 text-amber-400 text-[10px] py-0">any-join</Badge>}
                </span>
              </div>
              {!readonly && (
                <div className="flex gap-0.5">
                  <Button size="sm" variant="ghost" disabled={i === 0} title="Move up"
                    onClick={() => apply({ ...draft, nodes: reorder(draft.nodes, i, -1) })}>
                    <ArrowUp size={12} />
                  </Button>
                  <Button size="sm" variant="ghost" disabled={i === draft.nodes.length - 1} title="Move down"
                    onClick={() => apply({ ...draft, nodes: reorder(draft.nodes, i, +1) })}>
                    <ArrowDown size={12} />
                  </Button>
                  <Button size="sm" variant="ghost" title="Configure (Trigger / Config / Contract)" onClick={() => setConfiguring(n)}>
                    Configure
                  </Button>
                  <Button size="sm" variant="ghost" title="Remove step" onClick={() => removeNode(draft, n, apply)}>
                    <Trash2 size={12} />
                  </Button>
                </div>
              )}
            </Card>
          ))}
          {!readonly && (
            <Button variant="outline" onClick={() => setAdding(true)} className="border-dashed! text-muted-foreground self-start">
              <Plus size={13} /> Add node
            </Button>
          )}
        </div>
      </section>

      {/* ── edges ── */}
      <section className="mb-8">
        <h2 className="text-[13.5px] font-medium mb-2.5">Edges</h2>
        <div className="grid gap-1.5">
          {draft.edges.map((e, i) => (
            <Card key={`${e.from}->${e.to}#${i}`} className="px-3 py-2 flex items-center gap-2 flex-wrap">
              <EdgeSelect value={e.from} nodes={draft.nodes} disabled={readonly}
                onChange={(v) => apply({ ...draft, edges: draft.edges.map((p, j) => (j === i ? { ...p, from: v } : p)) })} />
              <span className="text-muted-foreground text-sm">→</span>
              <EdgeSelect value={e.to} nodes={draft.nodes} disabled={readonly}
                onChange={(v) => apply({ ...draft, edges: draft.edges.map((p, j) => (j === i ? { ...p, to: v } : p)) })} />
              <select
                value={e.kind}
                disabled={readonly}
                onChange={(ev) => apply({ ...draft, edges: draft.edges.map((p, j) => (j === i ? { ...p, kind: ev.target.value as EditorEdge["kind"] } : p)) })}
                className="bg-card text-foreground border border-border rounded-lg text-[12.5px] px-2 py-1.5"
              >
                {EDGE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <Input value={e.label ?? ""} placeholder="label (decision — Phase 3)" disabled={readonly} className="max-w-[210px] h-8 text-[12.5px]"
                onChange={(ev) => apply({ ...draft, edges: draft.edges.map((p, j) => (j === i ? { ...p, label: ev.target.value || null } : p)) })} />
              <Input value={e.condition ?? ""} placeholder="condition (JSONata — Phase 3)" disabled={readonly} className="max-w-[210px] h-8 text-[12.5px] font-mono"
                onChange={(ev) => apply({ ...draft, edges: draft.edges.map((p, j) => (j === i ? { ...p, condition: ev.target.value || null } : p)) })} />
              <div className="flex-1" />
              {!readonly && (
                <Button size="sm" variant="ghost" onClick={() => apply({ ...draft, edges: draft.edges.filter((_, j) => j !== i) })}>
                  <X size={12} />
                </Button>
              )}
            </Card>
          ))}
          {!readonly && (
            <Button variant="outline" size="sm" disabled={draft.nodes.length < 2} className="border-dashed! text-muted-foreground self-start"
              onClick={() => {
                const from = draft.nodes[0]?.key ?? "";
                const to = draft.nodes[1]?.key ?? "";
                apply({ ...draft, edges: [...draft.edges, { from, to, kind: "next", label: null, condition: null }] });
              }}>
              <Plus size={12} /> Add edge
            </Button>
          )}
        </div>
      </section>

      <NodeConfigurator
        open={configuring != null}
        node={configuring}
        onClose={() => setConfiguring(null)}
        onChange={(patch) => {
          if (!configuring) return;
          const next = { ...configuring, ...patch };
          setConfiguring(next);
          apply({ ...draft, nodes: draft.nodes.map((p) => (p.key === next.key ? next : p)) });
        }}
      />
      <AddNodeDialog
        open={adding}
        creativeBusy={creatingAgent}
        onClose={() => setAdding(false)}
        onAddCatalogNode={(nodeTemplateId, _isBuiltin, _catalogKey, name) => {
          const key = uniqueKey(name || "node", draft.nodes);
          apply({
            ...draft,
            nodes: [...draft.nodes, {
              key,
              nodeTemplateId,
              label: key,
              overrideLabel: null,
              trigger: { type: "auto" },
              join_mode: "all",
              config: {},
              input_map: {},
              kind: null,
              icon: null,
              catalog_name: name,
              is_builtin: false,
            }],
            edges: draft.edges.length === 0 && draft.nodes.length === 1
              ? [{ from: draft.nodes[0].key, to: key, kind: "next", label: null, condition: null }]
              : draft.edges,
          });
          setAdding(false);
        }}
        onCreateAgentNode={async (def) => {
          setCreatingAgent(true);
          try {
            const r = await fetch("/api/node-templates", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: def.name,
                kind: "agent",
                icon: "bot",
                description: `Declarative agent node (${def.mode})`,
                config: {
                  prompt: def.prompt,
                  mode: def.mode,
                  model: def.model,
                  output: def.output,
                  output_schema: def.output_schema,
                  inputs: def.inputs,
                },
              }),
            }).then((r) => r.json());
            if (r.error) return { err: r.error };
            const nodeTemplateId: string = r.nodeTemplate.id;
            const key = uniqueKey(def.name, draft.nodes);
            apply({
              ...draft,
              nodes: [...draft.nodes, {
                key,
                nodeTemplateId,
                label: key,
                overrideLabel: null,
                trigger: { type: "auto" },
                join_mode: "all",
                config: {},
                input_map: {},
                kind: "agent",
                icon: "bot",
                catalog_name: def.name,
                is_builtin: false,
              }],
            });
            setAdding(false);
            return { nodeTemplateId };
          } finally {
            setCreatingAgent(false);
          }
        }}
      />
    </main>
  );

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/templates/${draft.template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.template.name,
          description: draft.template.description,
          trigger: draft.template.trigger,
          nodes: draft.nodes.map((n) => ({
            key: n.key,
            nodeTemplateId: n.nodeTemplateId,
            label: n.overrideLabel ?? null,
            trigger: n.trigger,
            join_mode: n.join_mode,
            config: n.config,
            input_map: n.input_map,
          })),
          edges: draft.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind, label: e.label, condition: e.condition })),
        }),
      }).then((r) => r.json());
      if (r.error) setError(r.error);
      else {
        setDirty(false);
        setNotice("Draft saved — new flows snapshot this version.");
      }
    } finally {
      setSaving(false);
    }
  }
}

function EdgeSelect({ value, nodes, disabled, onChange }: { value: string; nodes: EditorNode[]; disabled: boolean; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="bg-card text-foreground border border-border rounded-lg text-[12.5px] px-2 py-1.5 font-mono"
    >
      {nodes.map((n) => <option key={n.key} value={n.key}>{n.key}</option>)}
    </select>
  );
}

function reorder(nodes: EditorNode[], i: number, dir: -1 | 1): EditorNode[] {
  const j = i + dir;
  if (j < 0 || j >= nodes.length) return nodes;
  const next = [...nodes];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Removes the node and any edges touching it. */
function removeNode(draft: Draft, node: EditorNode, apply: (d: Draft) => void) {
  apply({
    ...draft,
    nodes: draft.nodes.filter((n) => n.key !== node.key),
    edges: draft.edges.filter((e) => e.from !== node.key && e.to !== node.key),
  });
}

function uniqueKey(base: string, nodes: EditorNode[]): string {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "node";
  if (!nodes.some((n) => n.key === slug)) return slug;
  for (let i = 2; ; i++) if (!nodes.some((n) => n.key === `${slug}_${i}`)) return `${slug}_${i}`;
}
