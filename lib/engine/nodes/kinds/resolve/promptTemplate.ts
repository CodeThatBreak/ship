import 'server-only';

import type { PromptTemplate } from '../../../prompts/promptDefaults';

/**
 * The resolve contract block's locked shell: the per-action semantics the
 * JSON Schema cannot carry (reply required for answered/wontfix, one decision
 * per listed comment id, resolve authority). The `{{contract}}` placeholder
 * renders `AgentOutputError.directive(RESOLVE_RESPONSE_JSON_SCHEMA)` at run
 * time — generated from the Zod schema, so the advertised schema and the
 * validator can never drift. Preview and run pass the identical value, so the
 * rendered block is byte-equal in both (I7).
 *
 * Role framing lives in the editable body (AGENTS §3.2): the user can read,
 * tune or replace it — the locked blocks carry no "who you are" prose that
 * would silently override their edit.
 */
const RESOLVE_CONTRACT_TEXT = [
  `Contract semantics:`,
  `- return exactly one decision for every comment id listed below — reference the [id] tags; no unknown ids, no duplicates`,
  `- "fixed": commit the fix to branch {{branch}}; "reply" is the short what-changed note (optional)`,
  `- "answered": "reply" is REQUIRED — it is posted into the thread as the answer to the reviewer's question`,
  `- "wontfix": "reply" is REQUIRED — it is posted into the thread explaining why the code will not change`,
  `- "skipped": no "reply" and "resolve: false"; put the reason in "note" (internal, never posted)`,
  `- "resolve: true" closes the thread on the MR — the engine honors it only for fixes verified on the remote MR head, or where your posted reply explicitly explains the code's state`,
  `- "codeChanged" is your self-report; the engine verifies code movement and push state itself`,
  `- when no comments are listed below (developer-instruction run), return "decisions": []`,
  ``,
  `{{contract}}`,
].join('\n');

/**
 * The resolve node's own prompt template — defined next to the node def
 * (AGENTS §3.2) and registered in `DEFAULT_PROMPT_TEMPLATES` by
 * `promptDefaults.ts`, so `PromptLibrary` stays the one assembly path.
 *
 * The editable body carries the role framing (visible and tunable in the
 * prompt modal); the internal blocks are the locked output contract only —
 * the semantics the schema can't express, plus the schema-generated directive
 * the code parses.
 */
export const resolveTemplate: PromptTemplate = {
  label: 'Comment resolution',
  description: 'Sent to the agent to address open MR review comments by committing fixes or replying.',
  userTemplate: [
    `You are the comment-resolution agent for the open review comments of merge-request branch {{branch}}: commit fixes to branch {{branch}} and reply in the comment threads.`,
    ``,
    `{{dev_instructions}}`,
  ].join('\n'),
  internalBlocks: [
    { kind: 'contract', text: RESOLVE_CONTRACT_TEXT }, // locked: semantics + {{contract}}
    // run data re-appends on every path (default, prompt-body knob, composer
    // first turn — where the user's message replaces the body verbatim):
    { kind: 'data', text: `Open merge-request comments:\n{{comments}}` },
    // engine-computed per-run note, present only when it happened:
    // "worktree deps setup failed: <err>" ({@link worktreeLifecycle}
    // ensureFlowWorktree, local mode) + the self-repair advisory
    { kind: 'data', text: `{{setup_note}}` },
  ],
  variables: ['branch', 'comments', 'dev_instructions', 'contract', 'setup_note'],
  mode: 'agent',
};
