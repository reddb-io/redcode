import { Redskilled } from "@opencode-ai/schema/redskilled"
import { InstanceState } from "@/effect/instance-state"
import { createSession, type ControlOperation, type Snapshot, type WorkflowOperation } from "@/redskilled/client"
import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { RedskilledApiError } from "../groups/redskilled"

const lastGood = new Map<string, { payload: Redskilled.Payload; at: string }>()

export const redskilledHandlers = HttpApiBuilder.group(InstanceHttpApi, "redskilled", (handlers) =>
  Effect.gen(function* () {
    const clients = yield* InstanceState.make((context) =>
      Effect.acquireRelease(
        Effect.tryPromise({
          try: () => createSession(context.directory),
          catch: error,
        }),
        (session) => Effect.sync(() => session.close()),
      ),
    )

    const status = (scope: Redskilled.Scope = "project") =>
      Effect.gen(function* () {
        const context = yield* InstanceState.context
        if (scope === "host") {
          return yield* new RedskilledApiError({
            message: "redskilled ACP exposes a project-scoped Worker projection; host scope is not available",
          })
        }
        const observed = yield* Effect.gen(function* () {
          const session = yield* InstanceState.get(clients)
          return yield* Effect.tryPromise({ try: () => session.snapshot(), catch: error })
        }).pipe(
          Effect.match({
            onFailure: (failure) => ({ failure }),
            onSuccess: (snapshot) => ({ snapshot }),
          }),
        )
        if ("failure" in observed) {
          yield* InstanceState.invalidate(clients)
          return unavailable(context.project.id, scope, observed.failure.message)
        }
        return yield* Schema.decodeUnknownEffect(Redskilled.Status)(
          project(observed.snapshot, context.project.id, scope),
        ).pipe(Effect.mapError((failure) => new RedskilledApiError({ message: failure.message })))
      })

    const control = (operation: ControlOperation) =>
      Effect.gen(function* () {
        const session = yield* InstanceState.get(clients).pipe(Effect.mapError(apiError))
        yield* Effect.tryPromise({ try: () => session.control(operation), catch: error }).pipe(
          Effect.mapError(apiError),
        )
        return yield* status("project")
      })

    const workflow = (operation: WorkflowOperation, input: Record<string, unknown>, worker?: string) =>
      Effect.gen(function* () {
        const session = yield* InstanceState.get(clients).pipe(Effect.mapError(apiError))
        if (worker) {
          const current = yield* Effect.tryPromise({ try: () => session.snapshot(), catch: error }).pipe(
            Effect.tapError(() => InstanceState.invalidate(clients)),
            Effect.mapError(apiError),
          )
          if (!current.state.workers.some((item) => item.worker_id === worker)) {
            return yield* new RedskilledApiError({ message: `Worker ${worker} does not belong to this ACP Project` })
          }
        }
        yield* Effect.tryPromise({ try: () => session.workflow(operation, input), catch: error }).pipe(
          Effect.tapError(() => InstanceState.invalidate(clients)),
          Effect.mapError(apiError),
        )
        return yield* status("project")
      })

    return handlers
      .handle("status", (ctx) => status(ctx.query.scope ?? "project"))
      .handle("consent", (ctx) => control(ctx.payload.decision === "accepted" ? "drain" : "stop"))
      .handle("resize", (ctx) => workflow("resize", { target: ctx.payload.target }))
      .handle("stopProject", () => control("stop"))
      .handle("stopWorker", (ctx) => workflow("stopWorker", { worker: ctx.payload.worker }, ctx.payload.worker))
      .handle("recycleWorker", (ctx) => workflow("recycleWorker", { worker: ctx.payload.worker }, ctx.payload.worker))
      .handle("steerWorker", (ctx) => workflow("steerWorker", ctx.payload, ctx.payload.worker))
      .handle("steerStatus", () =>
        Effect.fail(
          new RedskilledApiError({
            message: "redskilled ACP core does not expose a typed steer_status result; polling is unavailable",
          }),
        ),
      )
  }),
)

function project(snapshot: Snapshot, key: string, scope: Redskilled.Scope): Redskilled.Status {
  const now = new Date().toISOString()
  const workers = snapshot.state.workers.flatMap((worker): Redskilled.Worker[] => {
    if (
      typeof worker.worker_id !== "string" ||
      typeof worker.pid !== "number" ||
      typeof worker.started_at !== "string"
    ) {
      return []
    }
    const budget = record(worker.budget)
    const declared = typeof budget?.memory_max === "string" ? budget.memory_max : null
    return [
      {
        worker_id: worker.worker_id,
        project_label: snapshot.state.project_label,
        pid: worker.pid,
        started_at: worker.started_at,
        uptime_ms: Math.max(0, Date.now() - Date.parse(worker.started_at)),
        vitals: { rss_bytes: null, sampled_at: null, age_ms: null, fresh: false },
        budget: {
          declared,
          bytes: null,
          used_bytes: null,
          used_fraction: null,
          enforceable: worker.isolated === true,
        },
        log: { last_line: null, published_at: null },
      },
    ]
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
      reason: "public redskilled ACP Project projection",
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
  const consent: Redskilled.Consent = registered ? "accepted" : "unknown"
  return {
    lifecycle: "degraded",
    consent,
    scope,
    native: true,
    activation: {
      eligible: true,
      project: snapshot.state.project_label,
      runner: "ACP",
    },
    payload,
    last_success_at: now,
  }
}

function unavailable(key: string, scope: Redskilled.Scope, message: string): Redskilled.Status {
  const cached = lastGood.get(key)
  return {
    lifecycle: "unavailable",
    consent: "unknown",
    scope,
    native: true,
    ...(cached ? { payload: cached.payload, last_success_at: cached.at } : {}),
    error: message,
  }
}

function apiError(value: Error) {
  return new RedskilledApiError({ message: value.message })
}

function error(value: unknown) {
  return value instanceof Error ? value : new Error(String(value))
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
