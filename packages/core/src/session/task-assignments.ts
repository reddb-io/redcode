export * as SessionTaskAssignments from "./task-assignments.js"

import { SubagentReview } from "@opencode/schema/subagent-review"
import type { SessionTodo } from "@opencode/schema/session-todo"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, DateTime, Effect, Layer, Semaphore } from "effect"
import { Job } from "../job.js"
import { SessionMessage } from "./message.js"
import { SessionSchema } from "./schema.js"
import { SessionStore } from "./store.js"
import { SessionTaskGraph } from "./task-graph.js"
import type { SessionTaskFacts } from "./task-facts.js"

const make = Effect.gen(function* () {
  const store = yield* SessionStore.Service
  const jobs = yield* Job.Service
  const lock = yield* Semaphore.make(1)

  // Include nested work: an idle child can still have descendants changing the shared checkout.
  const activity = Effect.fn("SessionTaskAssignments.activity")(function* (
    session: SessionSchema.Info,
    promptID: SessionMessage.ID,
  ): Effect.fn.Return<{ busy: boolean; updated: number }> {
    const observation = yield* store.observation(session.id, promptID)
    const job = yield* jobs.get(session.id)
    const background = (yield* jobs.pendingBackground).filter(
      (entry) => entry.recovery.kind === "shell" && entry.recovery.sessionID === session.id,
    )
    const children = yield* store.list({ parentID: session.id })
    const descendants = yield* Effect.forEach(children, (child) => activity(child, promptID))
    return {
      busy:
        !observation ||
        observation.execution !== "idle" ||
        observation.pending ||
        job?.status === "running" ||
        background.some((entry) => entry.status === "running") ||
        descendants.some((child) => child.busy),
      updated: Math.max(DateTime.toEpochMillis(session.time.updated), ...descendants.map((child) => child.updated)),
    }
  })

  const snapshot = Effect.fn("SessionTaskAssignments.snapshot")(function* (
    sessionID: SessionSchema.ID,
    tasks: ReadonlyArray<SessionTodo.Info>,
  ) {
    const children = yield* store.list({ parentID: sessionID })
    return (yield* Effect.forEach(children, (child) =>
      Effect.gen(function* () {
        const brief = SubagentReview.read(child.metadata)
        if (!brief?.task || brief.parentSessionID !== sessionID) return undefined
        const task = tasks.find((task) => task.id === brief.task?.id)
        const observed = yield* store.observation(child.id, SessionMessage.ID.make(brief.task.promptID))
        const state = yield* activity(child, SessionMessage.ID.make(brief.task.promptID))
        return {
          taskID: brief.task.id,
          sessionID: child.id,
          revision: brief.task.revision,
          assigned: brief.task.assigned,
          busy: state.busy,
          admission: observed?.admission,
          current: task !== undefined && brief.task.fingerprint === SessionTaskGraph.fingerprint(task, tasks),
          state: state.busy || observed?.admission !== "delivered" ? ("running" as const) : ("settled" as const),
          settledAt: Math.max(state.updated, brief.result?.at ?? brief.task.assigned),
          review: brief.result?.decision ?? "unverified",
        }
      }),
    )).filter((entry) => entry !== undefined)
  })

  return { snapshot, withMutation: lock.withPermits(1) }
})

/** Parent verification reconciles the current contract only after every delegated effect settles. */
export function completionError(
  assignments: ReadonlyArray<Effect.Success<ReturnType<Effect.Success<typeof make>["snapshot"]>>[number]>,
  task: SessionTodo.Info,
  results: ReadonlyArray<SessionTaskFacts.Result>,
) {
  const related = assignments.filter((entry) => entry.taskID === task.id)
  if (!related.length) return
  if (related.some((entry) => entry.state !== "settled")) return `Task ${task.id} has unsettled delegated work`
  const latest = related.toSorted((a, b) => b.assigned - a.assigned)[0]!
  if (!latest.current)
    return `Task ${task.id} changed after delegation; continue its subagent with the current contract`
  const proof = results.find(
    (entry) => entry.callID === task.evidence?.callID && entry.messageID === task.evidence?.messageID,
  )
  if (
    !proof?.successful ||
    proof.kind !== "verification" ||
    proof.completed <= Math.max(...related.map((entry) => entry.settledAt))
  )
    return `Task ${task.id} needs parent verification after delegated work settles; a returned summary is not acceptance evidence`
}

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()(
  "@redcode/SessionTaskAssignments",
) {}
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [SessionStore.node, Job.node],
})
