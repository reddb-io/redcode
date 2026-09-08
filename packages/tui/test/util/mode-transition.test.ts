import { expect, test } from "bun:test"
import type { ToolPart } from "@reddb-io/redcode-sdk/v2"
import { modeTransition } from "../../src/util/mode-transition"

const completed = {
  id: "prt_plan",
  sessionID: "ses_plan",
  messageID: "msg_plan",
  type: "tool",
  callID: "call_plan",
  tool: "plan_exit",
  state: {
    status: "completed",
    input: {},
    output: "review finished",
    title: "Plan reviewed",
    metadata: {},
    time: { start: 1, end: 2 },
  },
} satisfies ToolPart

test("Plan-only and historical completions never authorize Build", () => {
  expect(modeTransition(completed)).toBeUndefined()
  expect(
    modeTransition({ ...completed, state: { ...completed.state, metadata: { agent: "plan", revision: "reviewed" } } }),
  ).toBeUndefined()
  expect(
    modeTransition({ ...completed, state: { ...completed.state, metadata: { agent: "build", revision: "approved" } } }),
  ).toBe("build")
})

test("running or failed handoffs do not switch the composer", () => {
  expect(
    modeTransition({
      ...completed,
      state: { status: "running", input: {}, metadata: { agent: "build" }, time: { start: 1 } },
    }),
  ).toBeUndefined()
  expect(
    modeTransition({
      ...completed,
      state: { status: "error", input: {}, error: "rejected", time: { start: 1, end: 2 } },
    }),
  ).toBeUndefined()
  expect(modeTransition({ ...completed, tool: "plan_enter" })).toBe("plan")
})
