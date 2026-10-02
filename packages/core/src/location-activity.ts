export * as LocationActivity from "./location-activity.js"

import { Cause, Clock, Context, Duration, Effect, Layer, Option, RcMap, Schema } from "effect"
import { Bus } from "./bus.js"
import { Form } from "./form.js"
import { Job } from "./job.js"
import { Location } from "./location.js"
import { LocationServiceMap } from "./location-service-map.js"
import { Permission } from "./permission.js"
import { SessionEvent } from "./session/event.js"
import { SessionExecution } from "./session/execution.js"
import { SessionStore } from "./session/store.js"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

const isSessionEvent = Schema.is(SessionEvent.Durable)

export class Service extends Context.Service<Service, {}>()("@opencode/LocationActivity") {}

export function layer(options: { readonly timeToLive?: Duration.Input; readonly sweepInterval?: Duration.Input } = {}) {
  return Layer.effect(
    Service,
    Effect.gen(function* () {
      const clock = yield* Clock.Clock
      const bus = yield* Bus.Service
      const locations = yield* LocationServiceMap.Service
      const execution = yield* SessionExecution.Service
      const sessions = yield* SessionStore.Service
      const jobs = yield* Job.Service
      const timeToLive = Duration.toMillis(options.timeToLive ?? "60 minutes")
      const entries = new Map<string, { readonly ref: Location.Ref; expiresAt: number }>()
      const key = (ref: Location.Ref) => `${LocationServiceMap.canonical(ref).directory}\0${ref.workspaceID ?? ""}`
      const touch = (ref: Location.Ref) =>
        Effect.sync(() => {
          entries.set(key(ref), { ref, expiresAt: clock.currentTimeMillisUnsafe() + timeToLive })
        })
      const runningShellLocations = jobs.runningBackgroundShellLocations.pipe(
        Effect.map((running) => new Set(running.map(key))),
      )

      // Waiting on a person produces no durable activity. Keep the whole Location
      // alive: a parent may also be idle while a child holds the question.
      const awaitingReply = (ref: Location.Ref) =>
        Effect.gen(function* () {
          const context = yield* locations.contextEffectOption(ref)
          if (Option.isNone(context)) return false
          const forms = Context.getOption(context.value, Form.Service)
          if (Option.isSome(forms) && (yield* forms.value.list()).length > 0) return true
          const permissions = Context.getOption(context.value, Permission.Service)
          return Option.isSome(permissions) && (yield* permissions.value.list()).length > 0
        }).pipe(
          // A short borrow must not retain the Location after checking pending input.
          Effect.scoped,
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : Effect.succeed(false),
          ),
        )

      const unsubscribe = yield* bus.listen((event) => {
        if (!isSessionEvent(event)) return Effect.void
        const location = event.location
        if (!location) return Effect.void
        return RcMap.has(locations.rcMap, location).pipe(
          Effect.flatMap((active) => (active ? touch(location) : Effect.void)),
        )
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      yield* Effect.gen(function* () {
        yield* Effect.sleep(options.sweepInterval ?? "1 minute")
        const refs = Array.from(yield* RcMap.keys(locations.rcMap))
        const cached = new Set(refs.map(key))
        yield* Effect.forEach(refs, (ref) => (entries.has(key(ref)) ? Effect.void : touch(ref)), { discard: true })
        for (const id of entries.keys()) {
          if (!cached.has(id)) entries.delete(id)
        }
        const now = clock.currentTimeMillisUnsafe()
        const expired = Array.from(entries.values()).filter((entry) => entry.expiresAt <= now)
        if (expired.length === 0) return
        const shells = yield* runningShellLocations
        const active = yield* Effect.forEach(yield* execution.active, (sessionID) => sessions.get(sessionID))
        yield* Effect.forEach(
          expired,
          (entry) =>
            Effect.gen(function* () {
              if (shells.has(key(entry.ref)) || (yield* awaitingReply(entry.ref))) return yield* touch(entry.ref)
              const owners = active.flatMap((session) =>
                session && key(session.location) === key(entry.ref) ? [session] : [],
              )
              // Invalidation only detaches the cache entry; borrowers retain the old
              // graph. Stop its executions and settle tool cleanup before detaching it.
              yield* Effect.forEach(
                owners,
                (session) => execution.interrupt(session.id, { reason: "inactivity", awaitSettlement: true }),
                {
                  discard: true,
                  concurrency: "unbounded",
                },
              )
              const remaining = yield* Effect.forEach(yield* execution.active, (sessionID) => sessions.get(sessionID))
              // New work admitted during cleanup may now own the cached graph.
              if (
                remaining.some((session) => session && key(session.location) === key(entry.ref)) ||
                (yield* runningShellLocations).has(key(entry.ref)) ||
                (yield* awaitingReply(entry.ref))
              ) {
                yield* touch(entry.ref)
                return
              }
              entries.delete(key(entry.ref))
              yield* Effect.logInfo("location services evicted", {
                directory: entry.ref.directory,
                workspaceID: entry.ref.workspaceID,
              }).pipe(Effect.andThen(locations.invalidate(entry.ref)))
            }),
          { discard: true, concurrency: "unbounded" },
        )
      }).pipe(Effect.forever, Effect.forkScoped)

      return Service.of({})
    }),
  )
}

export const node = makeGlobalNode({
  service: Service,
  layer: layer(),
  deps: [Bus.node, LocationServiceMap.node, SessionExecution.node, SessionStore.node, Job.node],
})
