import { expect, test } from "bun:test"
import { DateTime, Schema } from "effect"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionToolOutputPrune } from "@opencode/core/session/tool-output-prune"

const user = (id: string) =>
  SessionMessage.User.make({
    id: SessionMessage.ID.make(id),
    type: "user",
    text: id,
    time: { created: DateTime.makeUnsafe(0) },
  })

const assistant = (id: string, tool: string, output: string) =>
  Schema.decodeUnknownSync(SessionMessage.Assistant)({
    id,
    type: "assistant",
    agent: "build",
    model: { providerID: "test", id: "model" },
    content: [
      {
        type: "tool",
        id: `call_${id}`,
        name: tool,
        state: { status: "completed", input: {}, content: [{ type: "text", text: output }] },
        time: { created: 0 },
      },
    ],
    time: { created: 0 },
  })

test("prunes old model-visible tool output while preserving durable messages and the last two exchanges", () => {
  const old = "old-output-".repeat(4_500)
  const messages = [
    user("msg_one"),
    assistant("msg_first", "read", old),
    user("msg_two"),
    assistant("msg_second", "bash", old),
    user("msg_three"),
    assistant("msg_third", "read", old),
    user("msg_four"),
    assistant("msg_fourth", "read", old),
  ]
  const visible = SessionToolOutputPrune.apply(messages, { enabled: true, keep: 0 })
  expect(visible).not.toBe(messages)
  for (const index of [1, 3]) {
    const message = visible[index]
    if (message?.type !== "assistant") throw new Error("Expected assistant message")
    const part = message.content[0]
    if (part?.type !== "tool" || part.state.status !== "completed") throw new Error("Expected completed tool")
    expect(part.state.content[0]).toEqual({
      type: "text",
      text: expect.stringContaining(`session_history({messageID:"${message.id}",toolCallID:"${part.id}"})`),
    })
  }
  expect(visible[5]).toBe(messages[5])
  expect(visible[7]).toBe(messages[7])
  expect(messages[1]).toEqual(assistant("msg_first", "read", old))
  expect(
    SessionToolOutputPrune.apply(messages, { enabled: true, keep: 0 }, { definitions: [{ name: "read" }] }),
  ).toBe(messages)
})

test("keeps small output, skill output, and output when pruning is disabled", () => {
  const messages = [
    user("msg_one"),
    assistant("msg_first", "read", "x".repeat(40_000)),
    assistant("msg_skill", "skill", "x".repeat(120_000)),
    user("msg_two"),
    user("msg_three"),
  ]
  expect(SessionToolOutputPrune.apply(messages, { enabled: true, keep: 0 })).toBe(messages)
  expect(SessionToolOutputPrune.apply(messages, { enabled: false, keep: 0 })).toBe(messages)
})
