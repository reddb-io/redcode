export * as WorktreeSessions from "./sessions"

import path from "path"
import type { WorktreeInventory } from "@reddb-io/redcode-core/worktree-inventory"

type SessionRow = {
  readonly id: string
  readonly title: string
  readonly directory: string
  readonly time: { readonly updated: number }
}

/** A session updated this recently may still be working; its worktree is protected from removal. */
const ACTIVE_MS = 3_600_000

/** Each worktree with the sessions working in it: a session belongs to the innermost worktree holding its directory. */
export function attach(inventory: WorktreeInventory.Inventory, sessions: readonly SessionRow[]) {
  const owner = (directory: string) =>
    inventory.worktrees
      .filter((item) => contains(item.path, directory))
      .toSorted((a, b) => b.path.length - a.path.length)[0]?.path
  return {
    ...inventory,
    worktrees: inventory.worktrees.map((item) => ({
      ...item,
      sessions: sessions
        .filter((session) => owner(session.directory) === item.path)
        .map((session) => ({ id: session.id, title: session.title })),
    })),
  }
}

/** Directories of recently active sessions, whose worktrees removal and cleaning must keep. */
export function busy(sessions: readonly SessionRow[], now = Date.now()) {
  return sessions.filter((session) => now - session.time.updated < ACTIVE_MS).map((session) => session.directory)
}

function contains(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}
