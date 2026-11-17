import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { SessionTodo } from "@opencode/schema/session-todo"
import { planTaskToTodoInput } from "@opencode/core/tool/plugin/plan-exit"

/** The exact regression that broke plan approval: a stored plan revision carries dependencies
 *  as an explicit null after a model's omitted array survives the round-trip, and the mapped todo
 *  must omit the key entirely instead of passing the null to todos.write. */
const task = (overrides: Record<string, unknown> = {}) => ({
  key: "repro",
  content: "Fase 1",
  criterion: "repro estavel",
  quote: "vamos testar",
  ...overrides,
}) as SessionTodo.PlanTask

describe("planTaskToTodoInput", () => {
  test("omits dependencies when the stored task carries an explicit null", () => {
    const todo = planTaskToTodoInput(task({ dependencies: null }))
    expect("dependencies" in todo).toBe(false)
  })

  test("omits dependencies when absent or empty, preserves non-empty arrays", () => {
    expect("dependencies" in planTaskToTodoInput(task())).toBe(false)
    expect(planTaskToTodoInput(task({ dependencies: [] }))).not.toHaveProperty("dependencies")
    expect(planTaskToTodoInput(task({ dependencies: ["fix"] })).dependencies).toEqual(["fix"])
  })

  test("every mapped todo shape decodes against SessionTodo.Input", () => {
    for (const dependencies of [undefined, null, [], ["fix"]]) {
      const shape = planTaskToTodoInput(task({ dependencies })) as unknown
      expect(Schema.decodeUnknownSync(SessionTodo.Input)(shape)).toBeTruthy()
    }
  })
})
