import { describe, expect, test } from "bun:test"
import { SessionWorkspaceSnapshot } from "@opencode/core/session/workspace-snapshot"

describe("SessionWorkspaceSnapshot.todoCounts", () => {
  const todo = (status: string, id = "t") => ({ id, status }) as never

  test("is deterministic and counts every known status, zero when none", () => {
    const all = [todo("pending"), todo("in_progress"), todo("pending")]
    expect(SessionWorkspaceSnapshot.todoCounts(all)).toEqual({
      pending: 2,
      in_progress: 1,
      blocked: 0,
      completed: 0,
      cancelled: 0,
    })
    expect(SessionWorkspaceSnapshot.todoCounts(all)).toEqual(SessionWorkspaceSnapshot.todoCounts(all))
  })

  test("counts historical status values under their own key instead of dropping them", () => {
    const all = [todo("pending"), todo("weird_legacy")]
    expect(SessionWorkspaceSnapshot.todoCounts(all)).toMatchObject({ pending: 1, weird_legacy: 1 })
  })
})

describe("SessionWorkspaceSnapshot.heading", () => {
  test("composes the facts in order and is empty-friendly", () => {
    expect(
      SessionWorkspaceSnapshot.heading({
        files: ["src/a.ts", "src/b.ts"],
        todos: {
          counts: {},
          working: [{ key: "k", label: "Fix the engine" }],
          blocked: [],
          next: [],
        },
        goal: { status: "active", stopAfter: "plan", objective: "fix it" },
      }),
    ).toBe("2 files changed · working on Fix the engine · goal active (plan)")
    expect(
      SessionWorkspaceSnapshot.heading({ files: [], todos: { counts: {}, working: [], blocked: [], next: [] }, goal: undefined }),
    ).toBe("no workspace changes recorded yet")
  })
})

describe("SessionWorkspaceSnapshot.boundFiles", () => {
  test("deduplicates, bounds and redacts", () => {
    const files = ["src/a.ts", "src/a.ts", `src/${"x".repeat(200)}.ts`, "ghp_0123456789abcdefghijklmnopqrstuv"]
    const bounded = SessionWorkspaceSnapshot.boundFiles(files, 2)
    expect(bounded.length).toBe(2)
    expect(bounded[0]).toBe("src/a.ts")
    const redacted = SessionWorkspaceSnapshot.boundFiles(["ghp_0123456789abcdefghijklmnopqrstuv"], 24)
    expect(redacted[0]).not.toContain("ghp_0123456789")
    expect(redacted[0]).toContain("[redacted:")
  })
})
