/**
 * resolveContract — the pure resolve output contract: parse (no_json /
 * agent_reported / schema_mismatch with coverage + refinements), the
 * presented open-comment list (id tags, markers, caps), and the retry prompt.
 * No DB writes here; the temp SQLite db is only because TemplateRenderer's
 * import graph touches `db` (isolated per db.test.setup, AGENTS.md §1).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-resolve-contract-")),
  "test.db",
);

const { ResolveOutputContract } = await import("./resolveContract");
const { RESOLVE_COMMENT_ACTION, RESOLVED_BY_AGENT } = await import("./constants/commentActions");
const { RETRYABLE_OUTPUT_ERRORS } = await import("./constants/retryableErrors");
const { AGENT_OUTPUT_ERROR } = await import("../../shared/agent/outputError/outputErrorExports");
import type { CommentRow } from "../../../../db/rows";
import type { AgentOutputErrorCode } from "../../shared/agent/outputError/outputErrorExports";

const row = (over: Partial<CommentRow>): CommentRow => ({
  id: "gl_1",
  flow_id: "flow-1",
  mr_iid: 7,
  discussion_id: "d1",
  author: "reviewer",
  body: "Rename the variable.",
  file_path: "src/a.ts",
  line: 2,
  status: "open",
  resolved_by: null,
  raw: null,
  created_at: "2026-11-04T09:00:00.000Z",
  updated_at: "2026-11-04T09:00:00.000Z",
  ...over,
});

const agentReply = (over: Partial<CommentRow>): CommentRow =>
  row({
    discussion_id: "d1",
    body: "Done, renamed.",
    status: "resolved",
    resolved_by: RESOLVED_BY_AGENT,
    created_at: "2026-11-04T18:00:00.000Z",
    ...over,
  });

const decision = (over: Partial<Record<"id" | "action" | "reply" | "resolve" | "note", unknown>>) => ({
  id: "gl_1",
  action: "fixed",
  resolve: true,
  ...over,
});

const response = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ summary: "done", codeChanged: true, decisions: [], ...over });

const parseIssues = (err: { detail: { issues: { path: string; message: string }[] } }): { path: string; message: string }[] =>
  err.detail.issues;

const contract = new ResolveOutputContract();
const parseFail = (text: string, openIds: string[] = ["gl_1"]) => contract.parse(text, openIds);

describe("parseResolveResponse", () => {
  it("accepts a contract-conforming response covering every open id", () => {
    const parsed = contract.parse(
      response({ decisions: [decision({ action: "answered", reply: "two clients keep the driver decoupled.", resolve: false, note: "explained" })] }),
      ["gl_1"],
    );
    expect(parsed).toEqual({
      summary: "done",
      codeChanged: true,
      decisions: [
        { id: "gl_1", action: "answered", reply: "two clients keep the driver decoupled.", resolve: false, note: "explained" },
      ],
    });
  });

  it("extracts JSON from a fenced/prose response", () => {
    const parsed = contract.parse(
      `Here is my plan:\n\`\`\`json\n${response({ decisions: [decision({ id: "gl_9", resolve: false })] })}\n\`\`\``,
      ["gl_9"],
    );
    expect(parsed.decisions).toHaveLength(1);
  });

  it("throws no_json when nothing parseable is found", () => {
    try {
      parseFail("I cannot do this.");
      expect.unreachable();
    } catch (e) {
      expect((e as { code: string }).code).toBe(AGENT_OUTPUT_ERROR.NO_JSON);
    }
  });

  it("throws agent_reported for the error envelope and never counts it retryable", () => {
    try {
      parseFail(JSON.stringify({ output_error: { code: "blocked", reason: "the branch is force-pushed" } }));
      expect.unreachable();
    } catch (e) {
      expect((e as { code: string }).code).toBe(AGENT_OUTPUT_ERROR.AGENT_REPORTED);
      expect((e as { message: string }).message).toBe(
        "Resolve: the branch is force-pushed",
      );
    }
    // re-throwing the error here to assert on its code without a helper class
    let caught: unknown;
    try {
      parseFail(JSON.stringify({ output_error: { code: "blocked", reason: "r" } }));
    } catch (e) {
      caught = e;
    }
    expect(RETRYABLE_OUTPUT_ERRORS.has((caught as { code: AgentOutputErrorCode }).code)).toBe(false);
  });

  it("throws schema_mismatch with issues when the shape is wrong", () => {
    try {
      parseFail(response({ decisions: [{ id: "gl_1" }] }));
      expect.unreachable();
    } catch (e) {
      const err = e as { code: string; detail: { issues: { path: string; message: string }[] } };
      expect(err.code).toBe(AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH);
      expect(err.detail.issues.length).toBeGreaterThan(0);
      expect(err.detail.issues.some((i) => i.path.includes("action"))).toBe(true);
    }
  });

  it("names the missing comment id in the coverage issues", () => {
    try {
      contract.parse(
        response({ decisions: [decision({ id: "gl_2" })] }),
        ["gl_1", "gl_2"],
      );
      expect.unreachable();
    } catch (e) {
      const err = e as { detail: { issues: { message: string }[] } };
      expect(err.detail.issues.some((i) => i.message.includes('"gl_1"'))).toBe(true);
    }
  });

  it("rejects an unknown id and a duplicate id with named issues", () => {
    const check = (text: string) => {
      try {
        contract.parse(text, ["gl_1"]);
        expect.unreachable();
      } catch (e) {
        return e as { detail: { issues: { message: string }[] } };
      }
    };
    const unknown = check(response({ decisions: [decision({ id: "gl_1" }), decision({ id: "gl_99", resolve: false })] }));
    expect(unknown.detail.issues.some((i) => i.message.includes('unknown comment id "gl_99"'))).toBe(true);
    const dup = check(response({ decisions: [decision({ id: "gl_1" }), decision({ id: "gl_1", resolve: false })] }));
    expect(dup.detail.issues.some((i) => i.message.includes('duplicate decision for comment "gl_1"'))).toBe(true);
  });

  it("answers/wontfix require a reply", () => {
    for (const action of [RESOLVE_COMMENT_ACTION.ANSWERED, RESOLVE_COMMENT_ACTION.WONTFIX] as const) {
      try {
        contract.parse(response({ decisions: [decision({ action, resolve: false })] }), ["gl_1"]);
        expect.unreachable();
      } catch (e) {
        const issues = parseIssues(e as never);
        expect(
          issues.some(
            (i) => i.path.endsWith(".reply") && i.message.includes(`"${action}" requires a reply`),
          ),
        ).toBe(true);
      }
    }
  });

  it("skipped must not resolve and must not carry a reply", () => {
    try {
      contract.parse(
        response({ decisions: [decision({ action: RESOLVE_COMMENT_ACTION.SKIPPED, resolve: true, reply: "noted" })] }),
        ["gl_1"],
      );
      expect.unreachable();
    } catch (e) {
      const issues = parseIssues(e as never);
      expect(issues.some((i) => i.path.endsWith("resolve") && i.message.includes("resolve: false"))).toBe(true);
      expect(issues.some((i) => i.path.endsWith("reply") && i.message.includes("must not include a reply"))).toBe(true);
    }
  });

  it("zero open comments make decisions: [] trivially valid", () => {
    const parsed = contract.parse(response(), []);
    expect(parsed.decisions).toEqual([]);
  });
});

describe("presentComments", () => {
  it("renders deterministic id-tagged lines with location and author", () => {
    const open = [
      row({ id: "gl_123", author: "reviewer" }),
      row({ id: "gl_125", body: "Drop the cast.", file_path: "src/b.ts", line: 9, author: "reviewer", discussion_id: "d2" }),
    ];
    const presented = contract.presentComments(open);
    expect(presented.text).toBe(
      [
        "- [gl_123] src/a.ts:2 — Rename the variable. (author: @reviewer)",
        "- [gl_125] src/b.ts:9 — Drop the cast. (author: @reviewer)",
      ].join("\n"),
    );
    expect(presented.ids).toEqual(["gl_123", "gl_125"]);
  });

  it("marks a resolvable comment without a file path with body only, null body as empty", () => {
    const presented = contract.presentComments([
      row({ id: "gl_126", file_path: null, line: null, discussion_id: "d3", raw: JSON.stringify({ resolvable: true }), author: null, body: null }),
    ]);
    expect(presented.text).toBe("- [gl_126] ");
    // no location segment, no "not resolvable" marker for a resolvable note
    expect(presented.text).not.toContain("not resolvable");
    expect(presented.ids).toEqual(["gl_126"]);
  });

  it("marks a non-resolvable MR note but still lists its id", () => {
    const presented = contract.presentComments([
      row({ id: "gl_124", file_path: null, line: null, discussion_id: null, raw: JSON.stringify({ resolvable: false }), body: "Question: why two clients?" }),
    ]);
    expect(presented.text).toBe(
      "- [gl_124] (MR note, not resolvable) — Question: why two clients? (author: @reviewer)",
    );
    expect(presented.ids).toEqual(["gl_124"]);
  });

  it("adds the already-replied marker from same-thread agent replies", () => {
    const open = [row({ id: "gl_125", discussion_id: "d2" })];
    const replies = [
      agentReply({ id: "gl_200", discussion_id: "d2", created_at: "2026-11-03T10:00:00.000Z" }),
      agentReply({ id: "gl_201", discussion_id: "d2", created_at: "2026-11-04T10:00:00.000Z" }),
    ];
    const presented = contract.presentComments(open, replies);
    expect(presented.text).toContain("you replied on 2026-11-04 — awaiting reviewer");
    // the latest reply wins
    expect(presented.text).not.toContain("2026-11-03");
  });

  it("ignores resolved-by-host rows and other threads' agent replies", () => {
    const open = [row({ id: "gl_1", discussion_id: "d1" })];
    const replies = [
      row({ id: "gl_101", discussion_id: "d1", status: "resolved", resolved_by: "reviewer", body: "host resolved" }),
      agentReply({ id: "gl_102", discussion_id: "other", body: "different thread" }),
    ];
    const presented = contract.presentComments(open, replies);
    expect(presented.text).not.toContain("awaiting reviewer");
  });

  it("per-comment bodies cap at 2 000 chars with a truncation suffix", () => {
    const presented = contract.presentComments([
      row({ id: "gl_1", body: "x".repeat(3000) }),
    ]);
    expect(presented.text).toContain("… (truncated)");
    expect(presented.text.length).toBeLessThan(2100);
  });

  it("caps the whole block at 40 000 chars, drops whole lines and names the truncation", () => {
    const open = Array.from({ length: 30 }, (_, i) =>
      row({ id: `gl_${i}`, body: "y".repeat(1999), file_path: `src/f${i}.ts`, author: null }),
    );
    const presented = contract.presentComments(open);
    expect(presented.text.length).toBeLessThanOrEqual(40_000);
    expect(presented.text).toContain("the open-comment list was truncated");
    expect(presented.ids.length).toBeGreaterThan(0);
    expect(presented.ids.length).toBeLessThan(open.length);
    // every kept line is whole and id-tagged
    for (const id of presented.ids) {
      expect(presented.text).toContain(`[${id}]`);
    }
    expect(presented.ids).toEqual(open.slice(0, presented.ids.length).map((r) => r.id));
  });
});

describe("resolveRetryPrompt", () => {
  it("carries the issues, the ids to cover, and the same advertised schema", () => {
    let failure: unknown;
    try {
      contract.parse(response(), ["gl_1", "gl_2"]);
    } catch (e) {
      failure = e;
    }
    const prompt = contract.retryPrompt(failure as never, ["gl_1", "gl_2"]);
    expect(prompt).toContain("missing decision for comment \"gl_1\"");
    expect(prompt).toContain("gl_1, gl_2");
    expect(prompt).toContain("RESPONSE FORMAT");
    // the advertised schema travels with the directive, pretty-printed
    expect(prompt).toContain('"decisions"');
    expect(prompt).toContain('"summary"');
  });

  it("for a no_json failure asks for a single re-emitted JSON object", () => {
    let failure: unknown;
    try {
      parseFail("no json here");
    } catch (e) {
      failure = e;
    }
    const prompt = contract.retryPrompt(failure as never, ["gl_1"]);
    expect(prompt).toContain("no JSON object could be parsed");
    expect(prompt).toContain("Re-emit your ENTIRE response as a single JSON object.");
  });
});
