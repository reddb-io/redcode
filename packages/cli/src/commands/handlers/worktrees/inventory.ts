import { Effect } from "effect"
import { WorktreeInventory } from "@opencode/core/worktree/inventory"
import { project } from "./shared"

export const inventory = Effect.fn("cli.worktrees.inventory")(function* () {
  const context = yield* project()
  const registered = yield* Effect.promise(() => context.client.worktree.list({ projectID: context.projectID }))
  const sessions = yield* Effect.promise(async () => {
    const rows: WorktreeInventory.Session[] = []
    let cursor: string | undefined
    do {
      const page = await context.client.session.list({ project: context.projectID, order: "desc", limit: 100, cursor })
      rows.push(
        ...page.data.map((session) => ({
          id: session.id,
          title: session.title,
          directory: session.location.directory,
          updated: session.time.updated,
        })),
      )
      cursor = page.cursor.next ?? undefined
    } while (cursor)
    return rows
  })
  return yield* Effect.promise(() => WorktreeInventory.collect({ cwd: process.cwd(), registered, sessions }))
})
