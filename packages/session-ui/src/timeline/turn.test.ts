import { describe, expect, test } from "bun:test"
import type { JsonValue, SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client/promise"
import { TimelineRow, type PartGroup } from "./timeline-row"
import { countSteps, editedFiles, liveActivity, projectTurnRows, stepSummary, turnEdited } from "./turn"

type Input = { [x: string]: JsonValue }

const completed = (name: string, input: Input = {}, metadata?: Input, id = `${name}-${Math.random()}`) =>
  ({
    id,
    type: "tool",
    name,
    state: { status: "completed", input, content: [{ type: "text", text: "" }], metadata },
    time: { created: 0, ran: 0, completed: 10 },
  }) satisfies SessionMessageAssistantTool

const failed = (name: string, input: Input = {}) =>
  ({
    id: `${name}-failed-${Math.random()}`,
    type: "tool",
    name,
    state: { status: "error", input, error: { type: "unknown", message: "boom" } },
    time: { created: 0, completed: 10 },
  }) as SessionMessageAssistantTool

const running = (name: string, ran: number) =>
  ({
    id: `${name}-running`,
    type: "tool",
    name,
    state: { status: "running", input: {}, metadata: {} },
    time: { created: ran - 5, ran },
  }) satisfies SessionMessageAssistantTool

const assistant = (
  content: SessionMessageAssistant["content"],
  time: SessionMessageAssistant["time"] = { created: 0 },
): SessionMessageAssistant => ({
  id: "assistant",
  type: "assistant",
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content,
  time,
})

describe("countSteps", () => {
  test("counts calls per kind in summary order, files for edits and reads, and failures", () => {
    const counts = countSteps([
      completed("read", { path: "a.ts" }),
      completed("shell", {}, { exit: 0 }),
      completed("shell", {}, { exit: 1 }),
      completed("edit", { path: "a.ts" }),
      completed("edit", { path: "a.ts" }),
      failed("write", { path: "b.ts" }),
      completed("read", { path: "a.ts" }),
      completed("read", { filePath: "c.ts" }),
      completed("grep"),
      completed("subagent"),
      completed("subagent"),
      completed("todowrite"),
      completed("mcp_custom"),
    ])
    expect(counts).toEqual([
      { kind: "command", count: 2, failed: 1 },
      { kind: "edit", count: 2, failed: 1 },
      { kind: "read", count: 2, failed: 0 },
      { kind: "search", count: 1, failed: 0 },
      { kind: "agent", count: 2, failed: 0 },
      { kind: "other", count: 1, failed: 0 },
    ])
  })

  test("adds shell runs that are not tool calls and reads patch files from metadata", () => {
    const counts = countSteps([completed("patch", {}, { files: [{ file: "x.ts" }, { file: "y.ts" }] })], 2)
    expect(counts).toEqual([
      { kind: "command", count: 2, failed: 0 },
      { kind: "edit", count: 2, failed: 0 },
    ])
  })
})

describe("stepSummary", () => {
  const i18n = {
    plural: (key: string, count: number, params?: Record<string, string | number | boolean>) =>
      `${key}:${count}${params?.failed ? `/${params.failed}` : ""}`,
    list: (items: readonly string[]) => items.join(", "),
  }

  test("picks the failure phrase only for kinds with failures and capitalizes the sentence", () => {
    expect(
      stepSummary(
        [
          { kind: "command", count: 3, failed: 1 },
          { kind: "edit", count: 4, failed: 0 },
        ],
        i18n,
      ),
    ).toBe("Ui.sessionTurn.steps.commandFailed:3/1, ui.sessionTurn.steps.edit:4")
  })
})

describe("editedFiles", () => {
  test("sums changes per path and orders by size, keeping first appearance for ties", () => {
    const files = editedFiles([
      completed(
        "patch",
        {},
        {
          files: [
            { file: "small.ts", additions: 1, deletions: 0, status: "modified" },
            { file: "big.ts", additions: 10, deletions: 2, status: "added" },
          ],
        },
      ),
      completed("edit", { path: "small.ts", oldString: "a\nb\n", newString: "a\nc\nd\n" }),
      completed("write", { path: "tie.ts", content: "one\n" }),
      failed("edit", { path: "ignored.ts", oldString: "a", newString: "b" }),
    ])
    expect(files).toEqual([
      { path: "big.ts", additions: 10, deletions: 2, status: "added" },
      { path: "small.ts", additions: 3, deletions: 1, status: "modified" },
      { path: "tie.ts", additions: 1, deletions: 0, status: "modified" },
    ])
  })

  test("a deletion is final", () => {
    const files = editedFiles([
      completed("edit", { path: "gone.ts", oldString: "a", newString: "b" }),
      completed("patch", {}, { files: [{ file: "gone.ts", additions: 0, deletions: 4, status: "deleted" }] }),
    ])
    expect(files[0]?.status).toBe("deleted")
  })

  test("turnEdited only needs a completed edit tool", () => {
    expect(turnEdited([assistant([failed("edit"), completed("read")])])).toBe(false)
    expect(turnEdited([assistant([completed("write", { path: "a" })])])).toBe(true)
  })
})

describe("liveActivity", () => {
  test("reports the latest running tool from when it started running", () => {
    expect(liveActivity([assistant([completed("read"), running("shell", 500)])], 0)).toEqual({
      kind: "command",
      since: 500,
    })
  })

  test("reports streaming thoughts and reply text", () => {
    expect(
      liveActivity([assistant([{ type: "reasoning", text: "hm", time: { created: 40 } }], { created: 30 })], 0),
    ).toEqual({ kind: "thinking", since: 40 })
    expect(liveActivity([assistant([{ type: "text", text: "Hello" }], { created: 30 })], 0)).toEqual({
      kind: "writing",
      since: 30,
    })
  })

  test("falls back to working since the last thing that finished", () => {
    expect(liveActivity([assistant([completed("read")], { created: 5, completed: 80 })], 0)).toEqual({
      kind: "working",
      since: 80,
    })
    expect(liveActivity([], 12)).toEqual({ kind: "working", since: 12 })
  })
})

describe("projectTurnRows", () => {
  const row = (key: string, type: PartGroup["type"], userMessageID = "u1") =>
    new TimelineRow.AssistantPart({
      userMessageID,
      group:
        type === "part"
          ? { key, type, ref: { messageID: "a", partID: key } }
          : { key, type, refs: [{ messageID: "a", partID: key }] },
      previousAssistantPart: false,
    })
  const text = new Set(["intro", "reply", "reply-2", "only"])
  const project = (rows: TimelineRow.TimelineRow[], options: { open?: boolean; working?: boolean; edited?: boolean }) =>
    projectTurnRows(rows, {
      open: () => options.open ?? false,
      working: () => options.working ?? false,
      edited: () => options.edited ?? false,
      answer: (current) => current.group.type === "part" && text.has(current.group.key),
    })
  const keys = (rows: TimelineRow.TimelineRow[]) => rows.map(TimelineRow.key)
  const turn = [
    new TimelineRow.UserMessage({ userMessageID: "u1" }),
    row("intro", "part"),
    row("tools", "context"),
    row("reply", "part"),
    row("reply-2", "part"),
    row("updates", "context"),
    new TimelineRow.Error({ userMessageID: "u1", text: "failed" }),
  ]

  test("folds every step of a closed turn but keeps the reply, errors and the summary", () => {
    const result = project(turn, { edited: true })
    expect(keys(result.rows)).toEqual([
      "user-message:u1",
      "turn-summary:u1",
      "assistant-part:part:reply",
      "assistant-part:part:reply-2",
      "error:u1",
      "turn-changes:u1",
    ])
    expect(result.steps.size).toBe(0)
  })

  test("an open turn keeps every row and reports which ones are steps", () => {
    const result = project(turn, { open: true })
    expect(keys(result.rows)).toEqual([
      "user-message:u1",
      "turn-summary:u1",
      "assistant-part:part:intro",
      "assistant-part:context:tools",
      "assistant-part:part:reply",
      "assistant-part:part:reply-2",
      "assistant-part:context:updates",
      "error:u1",
    ])
    expect([...result.steps]).toEqual([
      "assistant-part:part:intro",
      "assistant-part:context:tools",
      "assistant-part:context:updates",
    ])
  })

  test("a running turn has no changes card yet, and a text-only turn has no summary", () => {
    expect(keys(project(turn, { open: true, working: true, edited: true }).rows)).not.toContain("turn-changes:u1")
    const plain = [new TimelineRow.UserMessage({ userMessageID: "u2" }), row("only", "part", "u2")]
    expect(keys(project(plain, { edited: true }).rows)).toEqual([
      "user-message:u2",
      "assistant-part:part:only",
      "turn-changes:u2",
    ])
  })

  test("leaves turns without a prompt row untouched", () => {
    const leading = [row("tools", "context", "u0"), row("reply", "part", "u0")]
    expect(project(leading, {}).rows).toEqual(leading)
  })
})
