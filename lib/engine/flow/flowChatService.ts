import "server-only";

import { db } from "../../db/app";
import { CHAT_DECLINED, nodeRoles } from "../nodes/shared/nodeRoles";
import { isNodeTerminalSuccess } from "../runtime/transitions/constants/statusSets";
import { TRIGGER_SOURCE } from "../runtime/triggers/constants/triggerSources";
import type { ChatHost } from "./types/chatHost";
import type { TriggerResult } from "../runtime/triggers/types/triggerGateway";

/**
 * FlowChatService — the chat paths carved out of the FlowEngine facade
 * (step 05, target-architecture §12's `flow/` focused services): a node's
 * chat turn claims the node through the authority's `chatRefine` transition,
 * routes the content through the §T4 role interfaces (`nodeRoles`) —
 * `chatOnly` asks a Converser for a lightweight conversational reply (node
 * state untouched); everything else goes to the node's ChatRefiner when its
 * capabilities opt in, and declines otherwise — and records both sides of
 * the conversation.
 *
 * Must never: write node status outside the authority's keyed transitions
 * (the `chatRefine` claim is the only write), or advance the template edges
 * for an already-successful node — its downstream already consumed the prior
 * output, so a done → done refine never re-advances.
 */
export class FlowChatService {
  constructor(private readonly host: ChatHost) {}

  async sendChat(flowId: string, nodeKey: string, content: string, model?: string, thread?: string | null): Promise<TriggerResult> {
    const def = await this.host.defOf(flowId, nodeKey);
    await db.addMessage(flowId, nodeKey, 'user', content, thread ?? null);
    // the pre-claim status decides "did THIS turn land a success terminal":
    // the claim flips the node to running, so it must be read first
    const preClaimStatus = await this.host.nodeStatus(flowId, nodeKey);
    // a waiting node's durable wait clears itself: the chatRefine claim below
    // leaves `waiting` through the authority, which clears wait_until
    const wasSuccess = isNodeTerminalSuccess(preClaimStatus ?? '');
    // the claim is the duplicate fence (step 06): a concurrent turn — or any
    // running node — loses it atomically and emits the typed skip event
    const result = await this.host.claimTrigger({ flowId, nodeKey, source: TRIGGER_SOURCE.UI, key: 'chatRefine' });
    if (!result.started) return result;

    this.host.bg(
      flowId,
      nodeKey,
      async () => {
        const flowCtx = await this.host.ctx(flowId);
        const chatRefiner = nodeRoles.chatRefinerOf(def);

        const chatResponse = !chatRefiner
          ? CHAT_DECLINED
          : await chatRefiner.turn(flowCtx, content, {
              model,
              thread,
              // the claim already flipped the row to `running` — the turn
              // needs the pre-claim status for its no-apply reverts
              previousStatus: preClaimStatus,
            });

        await db.addMessage(flowId, nodeKey, 'assistant', chatResponse || 'Done.', thread);
        // a refine turn that lands the node on a NEW success terminal
        // (failed → done via feedback, a first-turn chat run) obeys the same
        // terminal contract as retryNode / runNodeManual: advance the template
        // edges so the flow never stalls behind a recovery typed in the chat
        // panel. An already-successful node's refine (done → done) never
        // re-advances — its downstream already consumed the prior output.
        if (!wasSuccess && isNodeTerminalSuccess((await this.host.nodeStatus(flowId, nodeKey)) ?? '')) {
          await this.host.advanceFrom(flowId, nodeKey);
        }
      },
    );
    return result;
  }
}
