import { describe, expect, test } from "bun:test"
import { orphans } from "@/session/orphan"

type Message = Parameters<typeof orphans>[0][number]

const assistant = (id: string, completed?: number) =>
  ({
    info: { id, role: "assistant", time: { created: 1, ...(completed ? { completed } : {}) } },
    parts: [],
  }) as unknown as Message

const user = (id: string) => ({ info: { id, role: "user", time: { created: 1 } }, parts: [] }) as unknown as Message

describe("turns left behind by a dead process", () => {
  test("finds an assistant message nobody ever closed", () => {
    // The process that would have written `completed` was killed; the message stays open, and the
    // TUI reads open as "in progress" forever.
    expect(orphans([user("u1"), assistant("a1")]).map((m) => m.id)).toEqual(["a1"] as never)
  })

  test("leaves finished turns alone", () => {
    expect(orphans([user("u1"), assistant("a1", 2), user("u2"), assistant("a2", 3)])).toEqual([])
  })

  test("finds every one of them, not just the last", () => {
    // Several crashes in a row leave several open messages, and one sweep should end them all.
    expect(orphans([assistant("a1"), user("u1"), assistant("a2", 5), assistant("a3")]).map((m) => m.id)).toEqual(["a1", "a3"] as never)
  })

  test("ignores user messages, which never carry a completion", () => {
    expect(orphans([user("u1"), user("u2")])).toEqual([])
  })
})
