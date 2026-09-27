import { Location } from "@opencode/core/location"
import { InvalidRequestError } from "@opencode/protocol/errors"
import { Redskilled } from "@opencode/schema/redskilled"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"
import type { ControlOperation, Session, Snapshot, WorkflowOperation } from "../redskilled-client"

const lastGood = new Map<string, { payload: Redskilled.Payload; at: string }>()

export const RedskilledHandler = HttpApiBuilder.group(Api, "server.redskilled", (handlers) =>
  handlers
    .handle("redskilled.status", (ctx) =>
      response(Effect.gen(function* () {
        const location = yield* Location.Service
        const scope = ctx.query.scope ?? "project"
        if (scope === "host") return unavailable(location.project.id, scope, "Redskilled ACP exposes only project status")
        return yield* withSession(location.directory, (session) =>
          Effect.tryPromise({ try: () => session.snapshot(), catch: error }).pipe(
            Effect.map((snapshot) => project(snapshot, location.project.id)),
          ),
        ).pipe(Effect.catchAll((failure) => Effect.succeed(unavailable(location.project.id, scope, failure.message))))
      })),
    )
    .handle("redskilled.consent", (ctx) =>
      response(control(ctx.payload.decision === "accepted" ? "drain" : "stop")),
    )
    .handle("redskilled.project.resize", (ctx) => response(workflow("resize", { target: ctx.payload.target })))
    .handle("redskilled.project.stop", () => response(control("stop")))
    .handle("redskilled.worker.stop", (ctx) =>
      response(workflow("stopWorker", { worker: ctx.payload.worker }, ctx.payload.worker)),
    )
    .handle("redskilled.worker.recycle", (ctx) =>
      response(workflow("recycleWorker", { worker: ctx.payload.worker }, ctx.payload.worker)),
    )
    .handle("redskilled.worker.steer", (ctx) =>
      response(workflow("steerWorker", ctx.payload, ctx.payload.worker)),
    )
    .handle("redskilled.worker.steerStatus", () =>
      Effect.fail(new InvalidRequestError({
        message: "Redskilled ACP does not expose a typed steer status; polling is unavailable",
      })),
    ),
)

const withSession = <A, E, R>(directory: string, use: (session: Session) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.tryPromise({
      try: async () => {
        const { createSession } = await import("../redskilled-client.js")
        return createSession(directory)
      },
      catch: error,
    }),
    use,
    (session) => Effect.sync(() => session.close()),
  )

const control = (operation: ControlOperation) =>
  Effect.gen(function* () {
    const location = yield* Location.Service
    return yield* withSession(location.directory, (session) =>
      Effect.gen(function* () {
        yield* Effect.tryPromise({ try: () => session.control(operation), catch: error })
        return project(yield* Effect.tryPromise({ try: () => session.snapshot(), catch: error }), location.project.id)
      }),
    ).pipe(Effect.mapError(invalid))
  })

const workflow = (operation: WorkflowOperation, input: Record<string, unknown>, worker?: string) =>
  Effect.gen(function* () {
    const location = yield* Location.Service
    return yield* withSession(location.directory, (session) =>
      Effect.gen(function* () {
        if (worker) {
          const snapshot = yield* Effect.tryPromise({ try: () => session.snapshot(), catch: error })
          if (!snapshot.state.workers.some((item) => item.worker_id === worker))
            return yield* new InvalidRequestError({ message: `Worker ${worker} does not belong to this ACP Project` })
        }
        yield* Effect.tryPromise({ try: () => session.workflow(operation, input), catch: error })
        return project(yield* Effect.tryPromise({ try: () => session.snapshot(), catch: error }), location.project.id)
      }),
    ).pipe(Effect.mapError((failure) => failure instanceof InvalidRequestError ? failure : invalid(failure)))
  })

function project(snapshot: Snapshot, key: string): Redskilled.Status {
  const now = new Date().toISOString()
  const workers = snapshot.state.workers.flatMap((worker): Redskilled.Worker[] => {
    if (
      typeof worker.worker_id !== "string" ||
      typeof worker.pid !== "number" ||
      !Number.isInteger(worker.pid) ||
      typeof worker.started_at !== "string"
    )
      return []
    const budget = record(worker.budget)
    const declared = typeof budget?.memory_max === "string" ? budget.memory_max : null
    const started = Date.parse(worker.started_at)
    return [{
      worker_id: worker.worker_id,
      project_label: snapshot.state.project_label,
      pid: worker.pid,
      started_at: worker.started_at,
      uptime_ms: Number.isFinite(started) ? Math.max(0, Date.now() - started) : null,
      vitals: { rss_bytes: null, sampled_at: null, age_ms: null, fresh: false },
      budget: { declared, bytes: null, used_bytes: null, used_fraction: null, enforceable: worker.isolated === true },
      log: { last_line: null, published_at: null },
    }]
  })
  const registered = snapshot.control.drain_intent === "draining"
  const payload: Redskilled.Payload = {
    version: 1,
    generated_at: now,
    staleness: {
      sampled_at: now,
      age_ms: null,
      stale: true,
      measured_worker_count: 0,
      unmeasured_workers: workers.map((worker) => worker.worker_id),
      reason: "public Redskilled ACP Project projection",
    },
    host: {
      worker_count: workers.length,
      project_count: 1,
      measured_worker_count: 0,
      ceiling_used_fraction: null,
      ceiling: { memory_bytes: null, worker_count: null, interactive_reservation: 0 },
    },
    known_projects: [snapshot.state.project_label],
    registered_projects: registered ? [snapshot.state.project_label] : [],
    workers,
  }
  lastGood.set(key, { payload, at: now })
  return {
    lifecycle: "degraded",
    consent: registered ? "accepted" : "unknown",
    scope: "project",
    native: true,
    activation: {
      eligible: true,
      project: snapshot.state.project_label,
      runner: "ACP",
      ...(snapshot.control.requested_target == null ? {} : { target: snapshot.control.requested_target }),
    },
    ...(snapshot.control.context ? { queue: snapshot.control.context.queue } : {}),
    payload,
    last_success_at: now,
  }
}

function unavailable(key: string, scope: Redskilled.Scope, message: string): Redskilled.Status {
  const cached = scope === "project" ? lastGood.get(key) : undefined
  return {
    lifecycle: "unavailable",
    consent: "unknown",
    scope,
    native: true,
    ...(cached ? { payload: cached.payload, last_success_at: cached.at } : {}),
    error: message,
  }
}

function error(value: unknown) {
  return value instanceof Error ? value : new Error(String(value))
}

function invalid(value: Error) {
  return new InvalidRequestError({ message: value.message, kind: "redskilled" })
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
