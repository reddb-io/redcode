import { describe, expect } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { EventTable } from "@opencode/core/event/sql"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { TodoTable } from "@opencode/core/session/redcode.sql"
import { KVTable } from "@opencode/core/kv/sql"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      SessionInbox.node,
      Session.node,
    ]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      Project.node.replace(globalProjectNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
    ],
  ),
)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

describe("Session archive", () => {
  it.effect("archives and restores without executing, deleting or changing recency", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const store = yield* SessionStore.Service
      const database = yield* Database.Service
      const first = yield* session.create({ location, title: "Preserved" })
      const child = yield* session.create({ parentID: first.id })
      yield* session.archive({ sessionID: first.id, archived: true })
      const archived = yield* session.get(first.id)
      expect(archived.time.archived).toBeDefined()
      expect(archived.time.updated).toEqual(first.time.updated)
      expect((yield* session.list()).data.map((item) => item.id)).not.toContain(first.id)
      expect((yield* session.list({ archived: "only" })).data.map((item) => item.id)).toEqual([first.id])
      expect((yield* store.list({ parentID: first.id })).map((item) => item.id)).toEqual([child.id])
      expect((yield* session.list({ archived: "include" })).data).toHaveLength(2)
      yield* session.archive({ sessionID: first.id, archived: true })
      const events = yield* database.db.select().from(EventTable).where(eq(EventTable.aggregate_id, first.id)).all()
      expect(events.filter((item) => item.type === "session.archived.1")).toHaveLength(1)
      expect(yield* store.acquireExecution(first.id)).toBe(false)
      expect(yield* store.acquireExecution(child.id)).toBe(false)
      const inbox = yield* SessionInbox.Service
      const rejected = yield* inbox
        .admitSynthetic({ id: SessionMessage.ID.create(), sessionID: child.id, text: "pending" })
        .pipe(Effect.result)
      expect(rejected._tag).toBe("Failure")
      yield* session.archive({ sessionID: first.id, archived: false })
      expect((yield* session.get(first.id)).time.archived).toBeUndefined()
      expect((yield* session.list({ archived: "only" })).data).toEqual([])
      expect(yield* session.messages({ sessionID: first.id })).toEqual([])
      expect(yield* inbox.list(child.id)).toEqual([])
      expect((yield* session.active).size).toBe(0)
    }),
  )

  it.effect("refuses pending input, active ownership and suspended descendant work atomically", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const store = yield* SessionStore.Service
      const inbox = yield* SessionInbox.Service
      const database = yield* Database.Service
      const parent = yield* session.create({ location })
      const child = yield* session.create({ parentID: parent.id })
      const input = yield* inbox.admitSynthetic({ id: SessionMessage.ID.create(), sessionID: child.id, text: "queued" })
      expect((yield* session.archive({ sessionID: parent.id, archived: true }).pipe(Effect.result))._tag).toBe(
        "Failure",
      )
      expect((yield* session.get(parent.id)).time.archived).toBeUndefined()
      yield* inbox.cancel({ sessionID: child.id, id: input.id })
      expect(yield* store.acquireExecution(child.id)).toBe(true)
      expect((yield* session.archive({ sessionID: parent.id, archived: true }).pipe(Effect.result))._tag).toBe(
        "Failure",
      )
      yield* store.releaseExecution(child.id)
      yield* store.claim(child.id)
      expect((yield* session.archive({ sessionID: parent.id, archived: true }).pipe(Effect.result))._tag).toBe(
        "Failure",
      )
      yield* store.release(child.id)
      yield* session.archive({ sessionID: parent.id, archived: true })
      expect((yield* session.get(parent.id)).time.archived).toBeDefined()
      const rows = yield* database.db.select().from(EventTable).where(eq(EventTable.aggregate_id, parent.id)).all()
      expect(rows.filter((item) => item.type === "session.archived.1")).toHaveLength(1)
    }),
  )
  it.effect("keeps unfinished tasks and unconsumed background results visible before archive", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const database = yield* Database.Service
      const parent = yield* session.create({ location })
      const child = yield* session.create({ parentID: parent.id })
      yield* database.db
        .insert(TodoTable)
        .values({
          session_id: child.id,
          position: 0,
          content: "Finish verification",
          priority: "high",
          status: "blocked",
        })
        .run()
      expect((yield* session.archive({ sessionID: parent.id, archived: true }).pipe(Effect.result))._tag).toBe(
        "Failure",
      )
      yield* database.db.delete(TodoTable).where(eq(TodoTable.session_id, child.id)).run()
      yield* database.db
        .insert(KVTable)
        .values({
          key: "job.background/archive",
          value: {
            id: child.id,
            notificationID: "msg_archive_notification",
            status: "completed",
            output: "Result awaiting delivery",
            recovery: {
              kind: "subagent",
              parentSessionID: parent.id,
              childSessionID: child.id,
              agent: "build",
              description: "Archive fixture",
            },
          },
        })
        .run()
      expect((yield* session.archive({ sessionID: parent.id, archived: true }).pipe(Effect.result))._tag).toBe(
        "Failure",
      )
      yield* database.db.delete(KVTable).where(eq(KVTable.key, "job.background/archive")).run()
      yield* session.archive({ sessionID: parent.id, archived: true })
      expect((yield* session.get(parent.id)).time.archived).toBeDefined()
    }),
  )
})
