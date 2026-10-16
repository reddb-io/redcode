import { expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Context, Effect, Exit, Layer, Schema, Scope } from "effect"
import { WorkerLease } from "@opencode/core/worker-lease"
import { WorkerLeaseTable } from "@opencode/core/worker-lease.sql"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { SessionStore } from "@opencode/core/session/store"
import { SessionTable, SessionInboxTable } from "@opencode/core/session/sql"
import { ProjectTable } from "@opencode/core/project/sql"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { AbsolutePath } from "@opencode/schema/schema"
import { Project } from "@opencode/schema/project"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, WorkerLease.node, SessionStore.node])))
const claim = (owner: string): WorkerLease.Acquire => ({
  owner,
  holder: "runtime-one",
  sessionID: Session.ID.make(`ses_${owner}`),
  messageID: SessionMessage.ID.make(`msg_${owner}`),
  directory: AbsolutePath.make(process.cwd()),
})

it.effect("checkout ownership is atomic, durable, idempotent and blocks both live and expired competitors", () =>
  Effect.gen(function* () {
    const leases = yield* WorkerLease.Service
    const database = yield* Database.Service
    const results = yield* Effect.all([leases.acquire(claim("one")), leases.acquire(claim("two"))], {
      concurrency: "unbounded",
    })
    const acquired = results.find((result) => result.state === "acquired")!
    if (acquired.state !== "acquired") throw new Error("Expected a checkout owner")
    expect(results.filter((result) => result.state === "busy")).toHaveLength(1)
    expect(yield* leases.acquire(claim(acquired.lease.owner))).toMatchObject({
      state: "acquired",
      lease: {
        owner: acquired.lease.owner,
        generation: acquired.lease.generation,
        expiresAt: acquired.lease.expiresAt,
      },
    })
    const renewed = yield* leases.renew(acquired.lease)
    expect(renewed.generation).toBe(acquired.lease.generation)
    expect((yield* leases.acquire({ ...claim(acquired.lease.owner), holder: "replacement" })).state).toBe("held")
    expect(
      yield* leases.acquire({ ...claim(acquired.lease.owner), holder: "replacement", recover: acquired.lease }),
    ).toEqual({ state: "busy" })
    yield* database.db.update(WorkerLeaseTable).set({ expires_at: 1 }).run()
    expect(yield* leases.acquire(claim("competitor"))).toEqual({ state: "busy" })
    expect(Exit.isFailure(yield* leases.renew(renewed).pipe(Effect.exit))).toBe(true)
    expect(Exit.isFailure(yield* leases.enter(acquired.lease.sessionID, acquired.lease).pipe(Effect.exit))).toBe(true)
    const recovered = yield* leases.acquire({
      ...claim(acquired.lease.owner),
      holder: "runtime-two",
      recover: acquired.lease,
    })
    if (recovered.state !== "acquired") throw new Error("Expected original assignment recovery")
    expect(recovered.lease.generation).toBe(acquired.lease.generation + 1)
    expect(recovered.lease.holder).toBe("runtime-two")
    expect(Exit.isFailure(yield* leases.enter(acquired.lease.sessionID, acquired.lease).pipe(Effect.exit))).toBe(true)
    expect(Exit.isFailure(yield* leases.release(acquired.lease).pipe(Effect.exit))).toBe(true)
    yield* leases.release(recovered.lease)
    yield* leases.release(recovered.lease)
    expect((yield* leases.acquire(claim(acquired.lease.owner))).state).toBe("released")
    const successor = yield* leases.acquire(claim("successor"))
    if (successor.state !== "acquired") throw new Error("Expected next task after release")
    expect(successor.lease.generation).toBe(recovered.lease.generation + 1)
    expect(Exit.isFailure(yield* leases.enter(acquired.lease.sessionID, recovered.lease).pipe(Effect.exit))).toBe(true)
  }),
)

it.effect("in-flight commands pin the fence across expiry until their scope exits", () =>
  Effect.gen(function* () {
    const leases = yield* WorkerLease.Service
    const database = yield* Database.Service
    const acquired = yield* leases.acquire(claim("inflight"))
    if (acquired.state !== "acquired") throw new Error("Expected owner")
    const operation = yield* leases.enter(acquired.lease.sessionID, acquired.lease)
    expect(operation).toBeString()
    expect(Exit.isFailure(yield* leases.release(acquired.lease).pipe(Effect.exit))).toBe(true)
    yield* database.db.update(WorkerLeaseTable).set({ expires_at: 1 }).run()
    expect(yield* leases.acquire({ ...claim("inflight"), recover: acquired.lease })).toEqual({ state: "busy" })
    yield* leases.leave(operation)
    const recovered = yield* leases.acquire({ ...claim("inflight"), recover: acquired.lease })
    expect(recovered.state).toBe("acquired")
    if (recovered.state !== "acquired") throw new Error("Expected recovered lease")
    const scope = yield* Scope.make()
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
    const context = yield* Layer.buildWithScope(
      AppNodeBuilder.build(WorkerLease.node, [Database.node.replace(Layer.succeed(Database.Service, database))]).pipe(
        Layer.fresh,
      ),
      scope,
    )
    // A worker runtime that ends without leaving its operation must not pin recovery forever.
    yield* Context.get(context, WorkerLease.Service).enter(recovered.lease.sessionID, recovered.lease)
    yield* Scope.close(scope, Exit.void)
    yield* database.db.update(WorkerLeaseTable).set({ expires_at: 1 }).run()
    const afterRestart = yield* leases.acquire({
      ...claim("inflight"),
      holder: "after-restart",
      recover: recovered.lease,
    })
    expect(afterRestart.state).toBe("acquired")
  }),
)

it.effect("execution, suspended work, child executions and durable inboxes retain the checkout", () =>
  Effect.gen(function* () {
    const leases = yield* WorkerLease.Service
    const database = yield* Database.Service
    const store = yield* SessionStore.Service
    const first = claim("running")
    const acquired = yield* leases.acquire(first)
    if (acquired.state !== "acquired") throw new Error("Expected owner")
    const projectID = Project.ID.make("project")
    yield* database.db.insert(ProjectTable).values({ id: projectID, worktree: first.directory, sandboxes: [] }).run()
    const seed = (id: Session.ID, parent?: Session.ID) =>
      database.db
        .insert(SessionTable)
        .values({
          id,
          project_id: projectID,
          parent_id: parent,
          directory: first.directory,
          slug: id,
          title: id,
          version: "test",
        })
        .run()
    yield* seed(first.sessionID)
    const other = Session.ID.make("ses_other")
    const child = Session.ID.make("ses_child")
    yield* seed(other)
    yield* seed(child, first.sessionID)
    expect(yield* store.acquireExecution(other)).toBe(false)
    expect(yield* store.acquireExecution(first.sessionID)).toBe(true)
    expect(Exit.isFailure(yield* leases.release(acquired.lease).pipe(Effect.exit))).toBe(true)
    yield* store.releaseExecution(first.sessionID)
    yield* store.claim(first.sessionID)
    expect(Exit.isFailure(yield* leases.release(acquired.lease).pipe(Effect.exit))).toBe(true)
    yield* store.release(first.sessionID)
    expect(yield* store.acquireExecution(child)).toBe(true)
    expect(Exit.isFailure(yield* leases.enter(child).pipe(Effect.exit))).toBe(true)
    expect(Exit.isFailure(yield* leases.release(acquired.lease).pipe(Effect.exit))).toBe(true)
    yield* store.releaseExecution(child)
    yield* database.db
      .insert(SessionInboxTable)
      .values({
        id: first.messageID,
        session_id: child,
        type: "user",
        payload: { text: "private input" },
        delivery: "steer",
        enqueued_seq: 1,
      })
      .run()
    expect(Exit.isFailure(yield* leases.release(acquired.lease).pipe(Effect.exit))).toBe(true)
    yield* database.db.delete(SessionInboxTable).where(eq(SessionInboxTable.id, first.messageID)).run()
    yield* leases.release(acquired.lease)
    expect(yield* store.acquireExecution(first.sessionID)).toBe(false)
    expect(yield* store.acquireExecution(child)).toBe(false)
    expect(yield* store.acquireExecution(other)).toBe(true)
  }),
)

it.effect("public fences omit optional recovery and retain one canonical identity", () =>
  Effect.gen(function* () {
    expect(WorkerLease.Acquire).toBe(
      (yield* Effect.promise(() => import("@opencode/schema/worker-lease"))).WorkerLease.Acquire,
    )
    const input = WorkerLease.Acquire.make({ ...claim("wire"), recover: undefined })
    expect(Schema.encodeSync(WorkerLease.Acquire)(input)).not.toHaveProperty("recover")
  }),
)
