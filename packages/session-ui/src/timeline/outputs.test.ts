import { describe, expect, test } from "bun:test"
import type {
  JsonValue,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
} from "@opencode/client/promise"
import { sessionOutputCounts, sessionOutputs } from "./outputs"

type Input = { [x: string]: JsonValue }

const completed = (name: string, input: Input = {}, metadata?: Input, text = "") =>
  ({
    id: `${name}-${Math.random()}`,
    type: "tool",
    name,
    state: { status: "completed", input, content: [{ type: "text", text }], metadata },
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

const running = (name: string, input: Input = {}, metadata: Input = {}) =>
  ({
    id: `${name}-running-${Math.random()}`,
    type: "tool",
    name,
    state: { status: "running", input, metadata },
    time: { created: 0, ran: 1 },
  }) satisfies SessionMessageAssistantTool

const assistant = (content: SessionMessageAssistant["content"]): SessionMessageAssistant => ({
  id: `assistant-${Math.random()}`,
  type: "assistant",
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content,
  time: { created: 0, completed: 10 },
})

const user = (text: string) => ({ id: `user-${text}`, type: "user", text, time: { created: 0 } }) as SessionMessageInfo

describe("sessionOutputs", () => {
  test("is empty for a session without tools", () => {
    const outputs = sessionOutputs([user("hi"), assistant([{ type: "text", text: "hello" }])])
    expect(outputs).toEqual({ files: [], designs: [], subagents: [], web: [], filesRead: 0 })
    expect(sessionOutputCounts(outputs)).toEqual({ outputs: 0, subagents: 0, sources: 0 })
  })

  test("sums edited files across every turn, largest change first", () => {
    const outputs = sessionOutputs([
      assistant([
        completed("edit", { filePath: "/repo/a.ts" }, { files: [{ file: "a.ts", additions: 1, deletions: 1 }] }),
      ]),
      user("again"),
      assistant([
        completed("write", { filePath: "b.ts", content: "one\ntwo\nthree\n" }),
        completed("edit", { filePath: "/repo/a.ts" }, { files: [{ file: "a.ts", additions: 4, deletions: 0 }] }),
        failed("edit", { filePath: "c.ts" }),
      ]),
    ])
    expect(outputs.files).toEqual([
      { path: "a.ts", additions: 5, deletions: 1, status: "modified" },
      { path: "b.ts", additions: 3, deletions: 0, status: "modified" },
    ])
  })

  test("lists subagents once per child session with their latest status", () => {
    const outputs = sessionOutputs([
      assistant([
        completed(
          "subagent",
          { agent: "explore", description: "Map the router" },
          { sessionID: "ses_a", status: "completed" },
        ),
        // The earlier `task` tool recorded `sessionId` and `subagent_type`.
        completed("task", { subagent_type: "review", description: "Review the patch" }, { sessionId: "ses_b" }),
        completed("subagent", { agent: "test", description: "Run the suite" }, { sessionID: "ses_c", status: "running" }),
        failed("subagent", { agent: "explore", description: "Broken" }),
        running("subagent", { description: "Map the router again" }, { sessionID: "ses_a" }),
      ]),
    ])
    expect(outputs.subagents).toEqual([
      { sessionID: "ses_a", agent: "explore", title: "Map the router", status: "running" },
      { sessionID: "ses_b", agent: "review", title: "Review the patch", status: "done" },
      { sessionID: "ses_c", agent: "test", title: "Run the suite", status: "running" },
      { sessionID: undefined, agent: "explore", title: "Broken", status: "failed" },
    ])
  })

  test("collects fetched pages, searches with their result counts, and distinct files read", () => {
    const outputs = sessionOutputs([
      assistant([
        completed("webfetch", { url: "https://example.com/a" }),
        completed("webfetch", { url: "https://example.com/a" }),
        failed("webfetch", { url: "https://example.com/down" }),
        completed(
          "websearch",
          { query: "solid stores" },
          { provider: "exa" },
          "## [One](https://one.dev)\n\nbody\n\n## [Two](https://two.dev)",
        ),
        completed("websearch", { query: "bare urls" }, {}, "https://a.dev\nhttps://b.dev\nhttps://c.dev"),
        completed("read", { filePath: "/repo/a.ts" }),
        completed("read", { filePath: "/repo/a.ts" }),
        completed("read", { path: "b.ts" }),
        failed("read", { filePath: "/repo/missing.ts" }),
      ]),
    ])
    expect(outputs.web).toEqual([
      { kind: "fetch", url: "https://example.com/a", failed: false },
      { kind: "fetch", url: "https://example.com/down", failed: true },
      { kind: "search", query: "solid stores", results: 2, failed: false },
      { kind: "search", query: "bare urls", results: 3, failed: false },
    ])
    expect(outputs.filesRead).toBe(2)
    expect(sessionOutputCounts(outputs)).toEqual({ outputs: 0, subagents: 0, sources: 5 })
  })

  test("keeps the latest preview of each published design, newest first", () => {
    const outputs = sessionOutputs([
      assistant([
        completed("design_preview", { id: "design_1", name: "Landing" }, { id: "design_1" }),
        completed("design_preview", { id: "design_2", name: "Pricing" }, { id: "design_2" }),
        completed("design_preview", { id: "design_1", name: "Landing, revised" }, { id: "design_1" }),
      ]),
    ])
    expect(outputs.designs).toEqual([
      { id: "design_1", title: "Landing, revised" },
      { id: "design_2", title: "Pricing" },
    ])
    expect(sessionOutputCounts(outputs).outputs).toBe(2)
  })
})
