import { LocationServiceMap } from "@opencode/core/location-service-map"
import { SessionExecution } from "@opencode/core/session/execution"
import { Effect, RcMap, Schedule } from "effect"
import { EventFeed } from "./event-feed"

/** A bounded log trail survives an OS kill even when no memory panel is open. */
export const startMemoryDiagnostics = Effect.gen(function* () {
  const locations = yield* LocationServiceMap.Service
  const execution = yield* SessionExecution.Service
  const feed = yield* EventFeed.Service
  yield* Effect.gen(function* () {
    const memory = process.memoryUsage()
    const cachedLocations = Array.from(yield* RcMap.keys(locations.rcMap)).length
    const activeExecutions = Array.from(yield* execution.active).length
    const events = yield* feed.diagnostics
    // Counts and byte sizes only: no commands, credentials, prompts or project paths.
    // Use the existing rotating logger; never accumulate samples in process memory.
    yield* Effect.logInfo("server memory sample", {
      pid: process.pid,
      memory,
      cachedLocations,
      activeExecutions,
      eventSubscribers: events.subscribers,
      eventQueuedBytes: events.queuedBytes,
      eventRetainedBytes: events.retainedBytes,
    })
  }).pipe(
    Effect.catchCause(() => Effect.logDebug("server memory sample unavailable")),
    Effect.repeat(Schedule.spaced("1 minute")),
    Effect.forkScoped,
  )
})
