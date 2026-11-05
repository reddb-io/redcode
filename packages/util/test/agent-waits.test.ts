import { describe, expect, test } from "bun:test"
import { agentWaits } from "../src/agent-waits.js"

const tool = (id: string, name: string, input: unknown, status = "running") => ({
  type: "tool",
  id,
  name,
  state: { status, input },
  time: { created: 10, ran: 20 },
})
const assistant = (content: ReturnType<typeof tool>[], completed?: number) => ({
  type: "assistant",
  id: "message",
  time: { completed },
  content,
})

describe("agent waits", () => {
  test("reports concurrent explicit waits with their operation and actual start", () => {
    expect(
      agentWaits([
        assistant([
          tool("a", "monitor", { action: "wait", id: "mon_123" }),
          tool("b", "subagent", { agent: "reviewer" }),
          tool("c", "redcode_background_wait", { taskID: "task_123" }),
        ]),
      ]),
    ).toEqual([
      { id: "message:a", partID: "a", kind: "monitor", target: "mon_123", since: 20 },
      { id: "message:b", partID: "b", kind: "agent", target: "reviewer", since: 20 },
      { id: "message:c", partID: "c", kind: "task", target: "task_123", since: 20 },
    ])
  })

  test("does not infer waits from completed, background, or unrelated work or expose arbitrary inputs", () => {
    expect(
      agentWaits([
        assistant([tool("old", "monitor", { action: "wait", id: "mon_old" })], 30),
        assistant([
          tool("done", "monitor", { action: "wait" }, "completed"),
          tool("probe", "monitor", { action: "probe" }),
          tool("background", "subagent", { agent: "worker", background: true }),
          tool("shell", "shell", { command: "sleep 60" }),
          tool("private", "monitor", { action: "wait", id: "token=secret" }),
        ]),
      ]),
    ).toEqual([{ id: "message:private", partID: "private", kind: "monitor", target: undefined, since: 20 }])
  })
})
