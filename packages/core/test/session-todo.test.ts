import { describe, expect, test } from "bun:test"
import { SessionTodo } from "@opencode/core/session/todo"
import { SessionTaskFacts } from "@opencode/core/session/task-facts"
import { tool } from "./intelligence/fixtures"

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

  test("Design reconciliation lists task identities and fresh proof without asking for more corrections", () => {
    const reminder = SessionTodo.designReminder(
      [{ id: "todo_1", revision: 2, content: "Fix title contrast", status: "pending", priority: "high" }],
      {
        requests: [{ id: "msg_review", text: "Fix title contrast", created: 0 }],
        results: SessionTaskFacts.project([
          tool("msg_edit", "edit", { path: "index.html" }, { completed: 1 }),
          tool(
            "msg_audit",
            "design_export",
            { id: "design_profile" },
            { completed: 2, metadata: { jobStatus: "completed" } },
          ),
        ]),
      },
    )
    expect(reminder).toContain("todo_1 r2 [pending] Fix title contrast")
    expect(reminder).toContain("call_msg_audit (design_export, message msg_audit)")
    expect(reminder).toContain("do not edit, republish, export, audit, approve or start another correction cycle")
    expect(reminder).toContain("Keep partial, unresolved, unverified and user-approval tasks open")
  })

  test("Design reconciliation ignores failed, queued, outdated and stale proof and already completed tasks", () => {
    const task = { id: "todo_1", revision: 1, content: "Fix title contrast", status: "pending", priority: "high" }
    const requests = [{ id: "msg_review", text: task.content, created: 2 }]
    for (const messages of [
      [
        tool(
          "msg_failed",
          "design_export",
          { id: "design_profile" },
          { completed: 3, metadata: { jobStatus: "failed" } },
        ),
      ],
      [
        tool(
          "msg_queued",
          "design_export",
          { id: "design_profile" },
          { completed: 3, metadata: { jobStatus: "queued" } },
        ),
      ],
      [tool("msg_old", "design_preview", { id: "design_profile" }, { completed: 1 })],
      [
        tool("msg_preview", "design_preview", { id: "design_profile" }, { completed: 3 }),
        tool("msg_edit", "edit", { path: "index.html" }, { completed: 4 }),
      ],
      [tool("msg_read", "read", { path: "index.html" }, { completed: 3 })],
    ]) {
      expect(
        SessionTodo.designReminder([task], { requests, results: SessionTaskFacts.project(messages) }),
      ).toBeUndefined()
    }
    expect(
      SessionTodo.designReminder([{ ...task, status: "completed" }], {
        requests,
        results: SessionTaskFacts.project([
          tool("msg_current", "design_preview", { id: "design_profile" }, { completed: 3 }),
        ]),
      }),
    ).toBeUndefined()
  })
})
