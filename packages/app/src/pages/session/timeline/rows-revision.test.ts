import { describe, expect, mock, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import type { AssistantMessage, Part, UserMessage } from "@reddb-io/redcode-sdk/v2"

mock.module("@reddb-io/redcode-session-ui/message-part", () => ({
  renderable: () => true,
  groupParts: (refs: Array<{ messageID: string; part: { id: string } }>) =>
    refs.map((ref) => ({
      type: "part" as const,
      key: ref.part.id,
      ref: { messageID: ref.messageID, partID: ref.part.id },
    })),
}))

const { Timeline, TimelineRow } = await import("./rows")

const user = (id: string, created: number): UserMessage => ({
  id,
  sessionID: "ses_1",
  role: "user",
  time: { created },
  agent: "build",
  model: { providerID: "provider", modelID: "model" },
})
const assistant = (id: string, parentID: string, created: number) =>
  ({
    id,
    sessionID: "ses_1",
    role: "assistant",
    parentID,
    time: { created, completed: created + 1 },
    modelID: "model",
    providerID: "provider",
    mode: "build",
    agent: "build",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }) as AssistantMessage
const text = (id: string, messageID: string, value: string, extra: Partial<Part> = {}) =>
  ({ id, sessionID: "ses_1", messageID, type: "text", text: value, ...extra }) as Part
const tool = (id: string, messageID: string) =>
  ({
    id,
    sessionID: "ses_1",
    messageID,
    type: "tool",
    tool: "read",
    callID: id,
    state: { status: "completed", input: {}, output: "", title: "", metadata: {}, time: { start: 0, end: 1 } },
  }) as Part
const repair = (messageID: string, issues: string[]) =>
  text(`${messageID}-part`, messageID, "[system:response-quality-repair]", {
    synthetic: true,
    metadata: { responseRepair: { issues } },
  })

function rows(
  messages: Array<UserMessage | AssistantMessage>,
  parts: Record<string, Part[]>,
  status: "idle" | "busy" = "idle",
) {
  const byID = new Map(messages.map((message) => [message.id, message]))
  const source = messages.map(
    (message) => ({ id: message.id, type: message.role, time: message.time }) as unknown as SessionMessageInfo,
  )
  return Timeline.constructSessionMessageRows(
    source,
    (id) => byID.get(id),
    (id) => parts[id] ?? [],
    true,
    status,
    true,
    messages.filter((message): message is UserMessage => message.role === "user"),
  )
}

describe("S1-revised answers in the web timeline", () => {
  const messages = [
    user("msg_user", 1),
    assistant("msg_answer", "msg_user", 2),
    user("msg_repair", 4),
    assistant("msg_revision", "msg_repair", 5),
  ]
  const parts = {
    msg_user: [text("p_user", "msg_user", "teste")],
    msg_answer: [tool("p_tool", "msg_answer"), text("p_answer", "msg_answer", "Olá! Funcionando.")],
    msg_repair: [repair("msg_repair", ["unsupported"])],
    msg_revision: [text("p_revision", "msg_revision", "Olá! Em que posso ajudar?")],
  }

  test("shows the revision as the reply, keeps the superseded tool calls and adds the footnote", () => {
    const result = rows(messages, parts)
    expect(result.activeMessageID).toBe("msg_user")
    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_user",
      "assistant-part:msg_user:p_tool",
      "assistant-part:msg_user:p_revision",
      "revision:msg_user:msg_revision",
    ])
    const note = result.rows.find((row) => row._tag === "Revision")
    expect(note?._tag === "Revision" && { issues: note.issues, originals: note.originals }).toEqual({
      issues: ["unsupported"],
      originals: ["msg_answer"],
    })
  })

  test("keeps the answer visible and shows Revising while the revision has not started", () => {
    const result = rows(messages.slice(0, 3), parts, "busy")
    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_user",
      "assistant-part:msg_user:p_tool",
      "assistant-part:msg_user:p_answer",
      "revising:msg_user",
    ])
  })

  test("a later prompt the user wrote opens its own turn", () => {
    const result = rows([...messages, user("msg_next", 7), assistant("msg_next_answer", "msg_next", 8)], {
      ...parts,
      msg_next: [text("p_next", "msg_next", "another question")],
      msg_next_answer: [text("p_next_answer", "msg_next_answer", "answer")],
    })
    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_user",
      "assistant-part:msg_user:p_tool",
      "assistant-part:msg_user:p_revision",
      "revision:msg_user:msg_revision",
      "turn-gap:msg_next",
      "user-message:msg_next",
      "assistant-part:msg_next:p_next_answer",
    ])
  })
})
