import { config } from "../config";

export interface CreateAgentInput {
  prompt: string;
  repos?: { url: string; startingRef?: string }[];
  mode?: "agent" | "plan";
  autoCreatePR?: boolean;
  model?: string;
  name?: string;
  customSubagents?: { name: string; instructions: string }[]; // Phase 3B: max 20
}

export interface CursorRunResult {
  status: string;
  text?: string;
  durationMs?: number;
  git?: { branches?: { repoUrl: string; branch?: string; prUrl?: string }[] };
}

export interface RunUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  cost?: { rawCostCents?: number; chargedCents?: number };
  model?: string;
  [k: string]: any;
}

export interface StreamCallbacks {
  onStatus?: (s: string) => void;
  onAssistant?: (text: string) => void;
  onThinking?: (text: string) => void;
  onTool?: (name: string, status: string, args?: any, callId?: string, extra?: any) => void;
}

/**
 * Client for the Cursor cloud Agents API (api.cursor.com).
 *
 * Covers agent creation, follow-up runs, run inspection/cancel, usage
 * reporting, and SSE streaming of run events (with a polling fallback).
 */
export class CursorClient {
  private get baseUrl(): string {
    return config.cursor.baseUrl;
  }

  private auth(): HeadersInit {
    const key = config.cursor.apiKey();
    if (!key) throw new Error("CURSOR_API_KEY not set");
    return {
      Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
      "Content-Type": "application/json",
    };
  }

  private async api<T = any>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.auth(), ...(init?.headers || {}) },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Cursor API ${path} failed (${res.status}): ${body}`);
    }
    return res.json() as Promise<T>;
  }

  async createAgent(input: CreateAgentInput) {
    const body: any = {
      prompt: { text: input.prompt },
      mode: input.mode ?? "agent",
      autoCreatePR: input.autoCreatePR ?? false,
    };
    if (input.name) body.name = input.name;
    if (input.repos?.length) body.repos = input.repos;
    if (input.customSubagents?.length) body.customSubagents = input.customSubagents.slice(0, 20);
    const model = input.model ?? config.cursor.defaultModel();
    if (model) body.model = { id: model };
    return this.api("/v1/agents", { method: "POST", body: JSON.stringify(body) });
  }

  async followUp(agentId: string, prompt: string, mode?: "agent" | "plan") {
    const body: any = { prompt: { text: prompt } };
    if (mode) body.mode = mode;
    return this.api(`/v1/agents/${agentId}/runs`, { method: "POST", body: JSON.stringify(body) });
  }

  async getRun(agentId: string, runId: string): Promise<CursorRunResult> {
    return this.api(`/v1/agents/${agentId}/runs/${runId}`);
  }

  /** Per-run token usage + cost (cloud agents only — 401 until the team enables them). */
  async getRunUsage(agentId: string, runId: string): Promise<RunUsage | null> {
    try {
      return await this.api<RunUsage>(`/v1/agents/${agentId}/usage?runId=${encodeURIComponent(runId)}`);
    } catch {
      return null; // usage endpoint unavailable (cloud agents disabled) — caller falls back
    }
  }

  async cancelRun(agentId: string, runId: string) {
    return this.api(`/v1/agents/${agentId}/runs/${runId}/cancel`, { method: "POST" });
  }

  /** Stream a run to completion, invoking callbacks per event. Returns final result. */
  async streamRun(
    agentId: string,
    runId: string,
    cb: StreamCallbacks = {},
    timeoutMs = 30 * 60 * 1000
  ): Promise<CursorRunResult> {
    const res = await fetch(`${this.baseUrl}/v1/agents/${agentId}/runs/${runId}/stream`, {
      headers: { ...this.auth(), Accept: "text/event-stream" },
    });
    if (!res.ok || !res.body) {
      // fallback: poll the run
      return this.pollRun(agentId, runId, cb, timeoutMs);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let event = "";
    let result: CursorRunResult = { status: "UNKNOWN" };
    const start = Date.now();
    for (;;) {
      if (Date.now() - start > timeoutMs) throw new Error("cursor run timed out");
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trimEnd();
        buf = buf.slice(idx + 1);
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) {
          const payload = line.slice(5).trim();
          let data: any = {};
          try { data = JSON.parse(payload); } catch { /* keep */ }
          if (event === "status") cb.onStatus?.(data.status);
          else if (event === "assistant") cb.onAssistant?.(data.text ?? "");
          else if (event === "thinking") cb.onThinking?.(data.text ?? "");
          else if (event === "tool_call") {
            cb.onTool?.(data.name, data.status, data.args, data.callId ?? data.call_id, {
              result: data.result,
              truncated: data.truncated,
            });
          }
          else if (event === "result") { result = data; }
          else if (event === "error") throw new Error(data.message || payload);
        }
      }
    }
    if (result.status === "UNKNOWN" || !result.status) {
      result = await this.getRun(agentId, runId);
    }
    return result;
  }

  private async pollRun(
    agentId: string,
    runId: string,
    cb: { onStatus?: (s: string) => void },
    timeoutMs: number
  ): Promise<CursorRunResult> {
    const start = Date.now();
    for (;;) {
      if (Date.now() - start > timeoutMs) throw new Error("cursor run timed out");
      const r = await this.getRun(agentId, runId);
      cb.onStatus?.(r.status);
      if (["FINISHED", "ERROR", "CANCELLED", "EXPIRED"].includes(r.status)) return r;
      await new Promise((res) => setTimeout(res, 5000));
    }
  }
}

export const cursorClient = new CursorClient();
