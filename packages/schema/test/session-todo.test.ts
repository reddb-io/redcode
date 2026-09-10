import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { SessionTodo } from "../src/session-todo"

describe("task contracts", () => {
  test("reads old snapshots while rejecting unknown states on new writes", () => {
    const historical = { content: "Recover", status: "waiting", priority: "custom" }
    expect(Schema.is(SessionTodo.Info)(historical)).toBe(true)
    expect(Schema.is(SessionTodo.Input)(historical)).toBe(false)
    expect(Schema.is(SessionTodo.Input)({ ...historical, status: "pending", priority: "high" })).toBe(true)
    expect(Schema.is(SessionTodo.Input)({ ...historical, status: "done", priority: "high" })).toBe(false)
    expect(Schema.is(SessionTodo.Input)({ content: "", status: "pending", priority: "high" })).toBe(false)
  })

  test("omits tracking keys from old encoded snapshots and rejects invalid revisions", () => {
    expect(
      Schema.encodeSync(SessionTodo.Info)({
        content: "Keep",
        status: "pending",
        priority: "high",
        id: undefined,
        revision: undefined,
        reason: undefined,
      }),
    ).toEqual({ content: "Keep", status: "pending", priority: "high" })
    for (const revision of [0, -1, 1.5])
      expect(Schema.is(SessionTodo.Input)({ content: "Keep", status: "pending", priority: "high", revision })).toBe(
        false,
      )
  })
})
