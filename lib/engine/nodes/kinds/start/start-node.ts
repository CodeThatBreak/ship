import "server-only";

// ── the flow entry node ──────────────────────────────────────────────────────
import { z } from "zod";
import { NodeDefinition, type FlowCtx, type NodeTriggerRun, type RunOutcome } from "../../shared";
import type { NodeCapabilities } from "../../shared/capabilities";
import { NODE_KEYS } from "../../../constants/node-keys";
import {
  parseStartContract,
  StartContractConfigSchema,
  validateAgainstContract,
} from "./contract";

/**
 * The Start node — a template's entry point. It carries the branch trigger
 * (node with no incoming edge), finishes immediately, and publishes the
 * values the flow starts with (§5 start contract). Its outgoing edges
 * activate the rest of the template. Auto-started when the flow runs
 * (flow.start() — webhook/schedule trigger or the explicit start action for
 * manual templates).
 *
 * The contract (declared on the instance config) defines the fields a flow
 * starts with — one list serves as input AND output: whatever the trigger
 * provides is validated against it and published, so downstream nodes map
 * from those variables. Who provides the values follows the trigger type:
 * auto → the authored field defaults; manual/approval → the user fills the
 * form when triggering; webhook → the delivery payload must match the
 * contract. Without a declared contract the node behaves exactly as before
 * (finishes immediately, publishes nothing).
 */

/** trigger input / published output — validated against the contract in run() */
const StartPayload = z.record(z.string(), z.unknown());
type StartPayload = z.infer<typeof StartPayload>;

export class StartNode extends NodeDefinition<StartPayload, StartPayload> {
  readonly key = NODE_KEYS.START;
  readonly label = "Start";
  readonly promptKeys = [] as const;
  /** ahead of the plan node (10) so graphs display flow entry first */
  readonly order = 5;
  override readonly edges = [] as const;
  override readonly isEntry = true;
  override readonly capabilities: NodeCapabilities = { panelTitle: "Flow start" };
  /** nothing to recover — it just completes */
  override readonly retryable = false;

  readonly inputSchema = StartPayload;
  readonly outputSchema = StartPayload;

  /** the contract knobs — edited through the configurator's dedicated start
   *  contract editor, not the generic config form (configFields stays empty) */
  override readonly configSchema = StartContractConfigSchema;
  override readonly configFields = [] as const;

  /** the engine's auto-start input = whatever the flow trigger provided
   * (webhook delivery body / schedule fire payload — null for manual flows) */
  override triggerRuns(ctx: FlowCtx): NodeTriggerRun[] {
    return [{ input: (ctx.flow.trigger_payload as StartPayload | null) ?? {} }];
  }

  async run(ctx: FlowCtx, input: StartPayload, config: Record<string, unknown>): Promise<RunOutcome> {
    const fields = parseStartContract(config);
    let output: Record<string, unknown> = {};
    let event = "Flow started";
    if (fields.length) {
      const v = validateAgainstContract(fields, input);
      if (!v.ok) {
        // fails loudly — the engine marks the node failed with this message,
        // and (via startFromTemplate) a webhook delivery is rejected outright
        throw new Error(`start contract violated — ${v.error}`);
      }
      output = v.values;
      event = `Flow started — publishing ${Object.keys(output).join(", ") || "no values"}`;
    }
    return this.applyOutcome(ctx, {
      output,
      status: "done",
      event,
      reply: fields.length
        ? `Flow started with ${Object.keys(output).length} input value(s).`
        : "Flow started.",
    });
  }

  /** Nothing to recover — a start run finishing while the server was down is
   *  just done (the node already completes synchronously in one stage). */
  async recover(): Promise<boolean> {
    return true;
  }
}
