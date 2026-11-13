import { describe, expect, test } from "bun:test"
import type { SessionTodo } from "@opencode/schema/session-todo"
import { SessionTaskGraph } from "../src/session/task-graph"

const task = (id: string, parentID?: string, phase: "build" | "design" | "plan" = "build") =>
  ({ id, revision: 1, content: id, status: "pending", priority: "medium", phase, parentID }) as SessionTodo.Info

describe("SessionTaskGraph hierarchy", () => {
  test("accepts a same-phase parent without treating it as a dependency", () => {
    expect(SessionTaskGraph.validate([task("root"), task("child", "root")])).toBeUndefined()
  })

  test("rejects an unknown parent", () => {
    expect(SessionTaskGraph.validate([task("child", "missing")])).toBe("Unknown parent missing for task child")
  })

  test("rejects parent cycles", () => {
    expect(SessionTaskGraph.validate([task("one", "two"), task("two", "one")])).toContain(
      "Task hierarchy contains a cycle",
    )
  })

  test("rejects a parent from another phase", () => {
    expect(SessionTaskGraph.validate([task("design", undefined, "design"), task("build", "design")])).toBe(
      "Task build cannot have a parent from another phase: design",
    )
  })
})
