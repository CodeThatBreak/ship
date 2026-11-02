import { isDraftNodeTemplateId } from "../types";

/** Config keys that change declared input/output/choices — not prompts, scripts, or HTTP knobs. */
export const CONTRACT_RELEVANT_CONFIG_KEYS = [
  "contract",
  "choices",
  "output",
  "output_schema",
  "pass",
] as const;

export type ContractRelevantConfigKey = (typeof CONTRACT_RELEVANT_CONFIG_KEYS)[number];

export interface NodeContractRequestBody {
  def?: string;
  kind?: string;
  name?: string;
  config?: Record<string, unknown> | null;
}

export interface NodeContractRequest {
  /** TanStack Query cache identity — no large payloads. */
  cacheKey: string;
  body: NodeContractRequestBody;
}

const stableSerialize = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(obj[key])}`)
    .join(",")}}`;
};

/** FNV-1a over stable JSON — used only for cache keys, not security. */
export const hashStableJson = (value: unknown): string => {
  const serialized = stableSerialize(value);
  let hash = 2166136261;
  for (let i = 0; i < serialized.length; i += 1) {
    hash ^= serialized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

export const contractRelevantConfig = (
  config: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null => {
  if (!config) return null;
  const out: Record<string, unknown> = {};
  for (const key of CONTRACT_RELEVANT_CONFIG_KEYS) {
    if (key in config) out[key] = config[key];
  }
  return Object.keys(out).length ? out : null;
};

/** Memo dependency: changes only when contract-relevant config changes. */
export const contractConfigSignature = (
  config: Record<string, unknown> | null | undefined,
): string => {
  const subset = contractRelevantConfig(config);
  return subset ? stableSerialize(subset) : "none";
};

const identityKeyOf = (node: {
  nodeTemplateId: string;
  kind: string | null;
  catalog_name?: string | null;
}): string => {
  if (isDraftNodeTemplateId(node.nodeTemplateId)) {
    const bits = [`kind:${node.kind ?? "agent"}`];
    if (node.catalog_name) bits.push(`name:${node.catalog_name}`);
    return bits.join("|");
  }
  return `def:${node.nodeTemplateId}`;
};

export const nodeContractRequest = (
  node: {
    nodeTemplateId: string;
    kind: string | null;
    catalog_name?: string | null;
    config?: Record<string, unknown> | null;
  },
  configOverride?: Record<string, unknown> | null,
): NodeContractRequest => {
  const relevant = contractRelevantConfig(
    configOverride !== undefined ? configOverride : node.config,
  );
  const identity = identityKeyOf(node);
  const configHash = relevant ? hashStableJson(relevant) : "none";
  const cacheKey = `${identity}::cfg:${configHash}`;
  const body: NodeContractRequestBody = {};
  if (isDraftNodeTemplateId(node.nodeTemplateId)) {
    body.kind = node.kind ?? "agent";
    if (node.catalog_name) body.name = node.catalog_name;
  } else {
    body.def = node.nodeTemplateId;
  }
  if (relevant) body.config = relevant;
  return { cacheKey, body };
};

export const kindContractRequest = (
  kind: string,
  config?: Record<string, unknown> | null,
): NodeContractRequest => {
  const relevant = contractRelevantConfig(config ?? null);
  const configHash = relevant ? hashStableJson(relevant) : "none";
  const cacheKey = `kind:${kind}::cfg:${configHash}`;
  const body: NodeContractRequestBody = { kind };
  if (relevant) body.config = relevant;
  return { cacheKey, body };
};
