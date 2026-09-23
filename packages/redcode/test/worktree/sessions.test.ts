import { describe, expect, test } from "bun:test"
import path from "path"
import { WorktreeSessions } from "../../src/worktree/sessions"

const root = path.join(path.sep, "repo")
const nested = path.join(root, ".red", "worktrees", "setup-flow")
const info = (worktree: string, primary: boolean) => ({
  path: worktree,
  head: "abc",
  primary,
  current: false,
  locked: false,
  prunable: false,
  size: 0,
  sizePartial: false,
  changes: { tracked: 0, untracked: 0 },
  merged: false,
  sessions: [],
})

describe("worktree sessions", () => {
  test("a session belongs to the innermost worktree holding its directory", () => {
    const now = Date.now()
    const inventory = WorktreeSessions.attach({ root, worktrees: [info(root, true), info(nested, false)] }, [
      { id: "a", title: "Setup flow", directory: path.join(nested, "packages", "tui"), time: { updated: now } },
      { id: "b", title: "Primary", directory: root, time: { updated: now } },
      { id: "c", title: "Elsewhere", directory: path.join(path.sep, "other"), time: { updated: now } },
    ])
    expect(inventory.worktrees.map((item) => item.sessions.map((session) => session.id))).toEqual([["b"], ["a"]])
  })

  test("only recently active sessions protect their worktree", () => {
    const now = Date.now()
    expect(
      WorktreeSessions.busy(
        [
          { id: "a", title: "", directory: nested, time: { updated: now - 60_000 } },
          { id: "b", title: "", directory: root, time: { updated: now - 2 * 3_600_000 } },
        ],
        now,
      ),
    ).toEqual([nested])
  })
})
