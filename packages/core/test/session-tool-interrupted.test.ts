import { describe, expect, test } from "bun:test"
import { DateTime } from "effect"
import { Agent } from "@opencode/core/agent"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { SessionMessage } from "@opencode/core/session/message"
import { ToolInterrupted } from "@opencode/core/session/tool-interrupted"
import { toLLMMessages } from "@opencode/core/session/runner/to-llm-message"

const created = DateTime.makeUnsafe(0)
const id = (value: string) => SessionMessage.ID.make(`msg_${value}`)
const model = Model.Ref.make({ id: Model.ID.make("model"), providerID: Provider.ID.make("provider") })

const failedTool = (name: string, error: { type: string; message: string }, metadata?: Record<string, string>) =>
  SessionMessage.AssistantTool.make({
    type: "tool",
    id: `call-${name}`,
    name,
    state: SessionMessage.ToolStateError.make({
      status: "error",
      input: {},
      error,
      ...(metadata ? { metadata } : {}),
    }),
    time: { created, completed: created },
  })

const assistant = (
  value: string,
  content: SessionMessage.Assistant["content"],
  error?: { type: string; message: string },
) =>
  SessionMessage.Assistant.make({
    id: id(value),
    type: "assistant",
    agent: Agent.defaultID,
    model: { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") },
    content,
    ...(error ? { finish: "error" as const, error } : {}),
    time: { created, completed: created },
  })

const user = (value: string) =>
  SessionMessage.User.make({ id: id(value), type: "user", text: value, time: { created } })

describe("ToolInterrupted", () => {
  test("says the outcome is unknown for a tool that may change state", () => {
    const text = ToolInterrupted.result({ tool: "shell", detail: "Tool execution interrupted: shell" })
    expect(text).toStartWith("Tool execution interrupted: shell. ")
    expect(text).toContain("Its outcome is unknown")
  })

  test("says nothing changed for a read-only tool", () => {
    const text = ToolInterrupted.result({ tool: "read", detail: "Tool execution interrupted" })
    expect(text).toContain("nothing changed")
    expect(text).not.toContain("outcome is unknown")
  })

  test("keeps the tail of captured output within the limit", () => {
    const partial = "a".repeat(10) + "b".repeat(ToolInterrupted.PARTIAL_MAX_CHARS)
    const text = ToolInterrupted.result({ tool: "shell", detail: "Tool execution interrupted", partial })
    expect(text).toContain("[10 earlier characters omitted]")
    expect(text).toEndWith("b".repeat(ToolInterrupted.PARTIAL_MAX_CHARS))
    expect(text).not.toContain("a".repeat(10))
  })

  test("ignores empty or non-text captured output", () => {
    expect(ToolInterrupted.result({ tool: "shell", detail: "x", partial: "  " })).not.toContain("Output captured")
    expect(ToolInterrupted.result({ tool: "shell", detail: "x", partial: 3 })).not.toContain("Output captured")
  })

  test("recognizes only interruptions, not user declines", () => {
    expect(ToolInterrupted.interrupted({ type: "aborted", message: "Tool execution interrupted: shell" })).toBe(true)
    expect(ToolInterrupted.interrupted({ type: "aborted", message: "The user declined this tool call" })).toBe(false)
    expect(ToolInterrupted.interrupted({ type: "unknown", message: "Tool execution interrupted" })).toBe(false)
  })
})

describe("toLLMMessages after an interrupted step", () => {
  test("renders the interrupted call with its outcome and captured output", () => {
    const messages = toLLMMessages(
      [
        user("run it"),
        assistant("interrupted", [
          failedTool("shell", { type: "aborted", message: "Tool execution interrupted" }, { output: "partial line" }),
        ]),
      ],
      model,
    )
    const text = JSON.stringify(messages)
    expect(text).toContain("Its outcome is unknown")
    expect(text).toContain("partial line")
  })

  test("adds one trailing note to the next user message only", () => {
    const messages = toLLMMessages(
      [
        user("first"),
        assistant("interrupted", [failedTool("shell", { type: "aborted", message: "Tool execution interrupted" })], {
          type: "aborted",
          message: "Step interrupted",
        }),
        user("second"),
        assistant("done", [SessionMessage.AssistantText.make({ type: "text", text: "ok" })]),
        user("third"),
      ],
      model,
    )
    const users = messages.filter((message) => message.role === "user").map((message) => JSON.stringify(message))
    expect(users).toHaveLength(3)
    expect(users[0]).not.toContain(ToolInterrupted.NOTE)
    expect(users[1]).toContain(ToolInterrupted.NOTE)
    expect(users[2]).not.toContain(ToolInterrupted.NOTE)
  })

  test("leaves a declined call and the following message unchanged", () => {
    const messages = toLLMMessages(
      [
        user("first"),
        assistant("declined", [failedTool("shell", { type: "aborted", message: "The user declined this tool call" })]),
        user("second"),
      ],
      model,
    )
    const text = JSON.stringify(messages)
    expect(text).toContain("The user declined this tool call")
    expect(text).not.toContain("outcome is unknown")
    expect(text).not.toContain(ToolInterrupted.NOTE)
  })
})
