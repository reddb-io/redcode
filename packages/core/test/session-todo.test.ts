import { describe, expect, test } from "bun:test"
import { SessionTodo } from "@opencode/core/session/todo"

describe("SessionTodo", () => {
  test("todowrite guidance asks for a short title and keeps the full task in content", () => {
    expect(SessionTodo.guidance).toContain("title (one imperative line of at most 80 characters")
    expect(SessionTodo.guidance).toContain("full task with its acceptance detail in content")
  })

  test("the unfinished-task reminder and the blocker read the full content, not the title", () => {
    const content = `Exportar o relatório completo. ${"Cada linha precisa de data e valor. ".repeat(40)}`
    const reminder = SessionTodo.reminder([
      { id: "todo_1", title: "Exportar relatório", content, status: "in_progress", priority: "high" },
    ])
    expect(reminder).toContain(`- [in_progress] ${content}`)
    expect(
      SessionTodo.blocker([
        {
          id: "todo_1",
          title: "Exportar relatório",
          content,
          status: "blocked",
          priority: "high",
          reason: "Sem acesso",
        },
      ]),
    ).toBe(`${content}: Sem acesso`)
  })
})
