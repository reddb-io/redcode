import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client"
import { SessionActivity } from "../../src/util/session-activity"

const model = { id: "gpt-6", providerID: "openai" }

const user = (id: string): SessionMessageInfo => ({
  id,
  type: "user",
  text: "Fix the build",
  time: { created: 0 },
})

const assistant = (
  id: string,
  content: SessionMessageAssistant["content"],
  extra: Partial<SessionMessageAssistant> = {},
): SessionMessageAssistant => ({
  id,
  type: "assistant",
  agent: "build",
  model,
  content,
  time: { created: 1 },
  ...extra,
})

describe("SessionActivity.activity", () => {
  test("waits for the model before anything has come back", () => {
    const current = SessionActivity.activity([user("msg_1")])
    expect(current).toEqual({ phase: "waiting", step: 1 })
    expect(SessionActivity.describe(current)).toBe("Waiting for the model")
  })

  test("reports reasoning as thinking and streamed text as responding", () => {
    expect(SessionActivity.activity([user("msg_1"), assistant("msg_2", [{ type: "reasoning", text: "..." }])])).toEqual(
      { phase: "thinking", step: 1 },
    )
    expect(SessionActivity.activity([user("msg_1"), assistant("msg_2", [{ type: "text", text: "Here is" }])])).toEqual({
      phase: "writing",
      step: 1,
    })
  })

  test("names the running tool and the step a long run is on", () => {
    const messages = [
      user("msg_1"),
      assistant("msg_2", [], { time: { created: 1, completed: 2 } }),
      assistant("msg_3", [
        { type: "text", text: "Running the tests" },
        {
          type: "tool",
          id: "call_1",
          name: "bash",
          state: { status: "running", input: { command: "bun test" }, metadata: {} },
          time: { created: 3 },
        },
      ]),
    ]
    const current = SessionActivity.activity(messages)
    expect(current).toEqual({ phase: "tool", tool: "shell", preparing: false, step: 2 })
    expect(SessionActivity.describe(current)).toBe("Running shell · step 2")
  })

  test("counts the next step as waiting once the previous one settled", () => {
    const messages = [user("msg_1"), assistant("msg_2", [], { time: { created: 1, completed: 2 } })]
    expect(SessionActivity.describe(SessionActivity.activity(messages))).toBe("Waiting for the model · step 2")
  })

  test("restarts the step count with each prompt", () => {
    const messages = [
      user("msg_1"),
      assistant("msg_2", [], { time: { created: 1, completed: 2 } }),
      user("msg_3"),
      assistant("msg_4", [{ type: "text", text: "Again" }]),
    ]
    expect(SessionActivity.activity(messages)).toEqual({ phase: "writing", step: 1 })
  })
})

describe("SessionActivity.quiet", () => {
  test("stays silent while the run is young", () => {
    expect(SessionActivity.quiet({ phase: "thinking", step: 1 }, 0)).toBeUndefined()
    expect(SessionActivity.quiet({ phase: "thinking", step: 1 }, SessionActivity.QUIET_NOTICE_MS - 1)).toBeUndefined()
  })

  test("says plainly that nothing has arrived once it has been a while", () => {
    expect(SessionActivity.quiet({ phase: "waiting", step: 1 }, SessionActivity.QUIET_NOTICE_MS)).toBe(
      "no response from the model yet",
    )
    expect(SessionActivity.quiet({ phase: "tool", tool: "shell", preparing: false, step: 3 }, 600_000)).toBe(
      "no new output yet",
    )
  })

  test("moves the progress mark only when something new arrives", () => {
    const before = [user("msg_1"), assistant("msg_2", [{ type: "text", text: "Hel" }])]
    const same = [user("msg_1"), assistant("msg_2", [{ type: "text", text: "Hel" }])]
    const after = [user("msg_1"), assistant("msg_2", [{ type: "text", text: "Hello" }])]
    expect(SessionActivity.progress(same)).toBe(SessionActivity.progress(before))
    expect(SessionActivity.progress(after)).not.toBe(SessionActivity.progress(before))
  })
})

test("SessionActivity.guardHint names the guard and keeps the first line", () => {
  expect(
    SessionActivity.guardHint({ guard: "stall", detail: "No output for 5m, ending it at 10m unless it resumes" }),
  ).toBe("stall guard: No output for 5m, ending it at 10m unless it resumes")
  expect(SessionActivity.guardHint({ guard: "tool_timeout", detail: "first\nsecond" })).toBe(
    "tool timeout guard: first",
  )
})
