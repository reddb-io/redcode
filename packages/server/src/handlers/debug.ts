import { LocationServiceMap } from "@opencode/core/location-service-map"
import { SessionGuardLog } from "@opencode/core/session/guard-log"
import { SessionTaskFacts } from "@opencode/core/session/task-facts"
import { SessionTodoStore } from "@opencode/core/session/todo-store"
import { refusalKind } from "@opencode/core/session/todo-evidence"
import { Ripgrep } from "@opencode/core/ripgrep"
import { Location } from "@opencode/core/location"
import { Effect, Option, RcMap } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { requestRef } from "../location"
import { InvalidRequestError, ServiceUnavailableError } from "@opencode/protocol/errors"

export const DebugHandler = HttpApiBuilder.group(Api, "server.debug", (handlers) =>
  handlers
    .handle(
      "debug.rg.files",
      Effect.fn(function* (ctx) {
        const locations = yield* LocationServiceMap.Service
        return yield* Effect.gen(function* () {
          const ripgrep = yield* Ripgrep.Service
          const location = yield* Location.Service
          return yield* ripgrep
            .glob({
              cwd: location.directory,
              pattern: ctx.query.glob ?? "**/*",
              query: ctx.query.query,
              limit: ctx.query.limit ?? 10_000,
            })
            .pipe(Effect.mapError((error) => new ServiceUnavailableError({ message: error.message, service: "ripgrep" })))
        }).pipe(Effect.provide(locations.get(requestRef(ctx.request))))
      }),
    )
    .handle(
      "debug.rg.search",
      Effect.fn(function* (ctx) {
        const locations = yield* LocationServiceMap.Service
        return yield* Effect.gen(function* () {
          const ripgrep = yield* Ripgrep.Service
          const location = yield* Location.Service
          return yield* ripgrep
            .grep({
              cwd: location.directory,
              pattern: ctx.query.pattern,
              include: ctx.query.glob,
              limit: ctx.query.limit ?? 10_000,
            })
            .pipe(
              Effect.catchTag("Ripgrep.InvalidPatternError", (error) =>
                new InvalidRequestError({ message: error.message, field: "pattern" }),
              ),
              Effect.mapError((error) =>
                error instanceof Ripgrep.Error
                  ? new ServiceUnavailableError({ message: error.message, service: "ripgrep" })
                  : error,
              ),
            )
        }).pipe(Effect.provide(locations.get(requestRef(ctx.request))))
      }),
    )
    .handle(
      "debug.todos",
      Effect.fn(function* (ctx) {
        const todos = yield* SessionTodoStore.Service
        const facts = yield* SessionTaskFacts.Service
        const tasks = yield* todos.get(ctx.query.sessionID)
        const failed = (yield* facts.load(ctx.query.sessionID).pipe(Effect.orDie)).results
          .filter((result) => result.tool === "todowrite" && result.errored && !result.abandoned)
          .toSorted((a, b) => b.completed - a.completed)
        return {
          sessionID: ctx.query.sessionID,
          tasks: tasks.map((task) => ({
            id: task.id ?? "",
            status: task.status,
            priority: task.priority,
            content: task.content,
            revision: task.revision,
            ...(task.source
              ? {
                  source: {
                    type: task.source.type,
                    messageID: task.source.id,
                    quote: task.source.quote,
                    ...(task.source.paraphrase ? { paraphrase: task.source.paraphrase } : {}),
                  },
                }
              : {}),
            ...(task.criterion ? { criterion: task.criterion } : {}),
            ...(task.evidence
              ? {
                  evidence: `${task.evidence.tool} ${task.evidence.callID} (message ${task.evidence.messageID}): ${task.evidence.explanation.split("\n")[0]?.trim() ?? ""}`,
                }
              : {}),
            ...(task.reason ? { reason: task.reason } : {}),
            ...(task.scopeChange
              ? {
                  scopeChange: {
                    messageID: task.scopeChange.messageID,
                    quote: task.scopeChange.quote,
                    ...(task.scopeChange.paraphrase ? { paraphrase: task.scopeChange.paraphrase } : {}),
                  },
                }
              : {}),
            refusals: failed.filter((result) => {
              const input = result.input
              if (typeof input !== "object" || input === null || !("todos" in input) || !Array.isArray(input.todos))
                return false
              return input.todos.some(
                (item) =>
                  typeof item === "object" &&
                  item !== null &&
                  (("id" in item && item.id === task.id) || ("content" in item && item.content === task.content)),
              )
            }).length,
          })),
          errors: failed.slice(0, 20).map((result) => ({
            time: new Date(result.completed).toISOString(),
            kind: refusalKind(result.error),
            message: result.error.split("\n")[0]?.trim() ?? "",
            callID: result.callID,
          })),
        }
      }),
    )
    .handle(
      "debug.guards",
      Effect.fn(function* (ctx) {
        const guards = yield* SessionGuardLog.Service
        return {
          summary: yield* guards.summary({ since: ctx.query.since }),
          recent: yield* guards.recent({ since: ctx.query.since, limit: ctx.query.limit ?? 20 }),
        }
      }),
    )
    .handle(
      "debug.location",
      Effect.fn(function* () {
        const locations = Option.getOrThrow(yield* Effect.serviceOption(LocationServiceMap.Service))
        return Array.from(yield* RcMap.keys(locations.rcMap))
      }),
    )
    .handle(
      "debug.location.evict",
      Effect.fn(function* (ctx) {
        const locations = Option.getOrThrow(yield* Effect.serviceOption(LocationServiceMap.Service))
        // Resolve through requestRef so the key matches the shape the location
        // middleware cached the services under.
        yield* locations.invalidate(requestRef(ctx.request))
      }),
    ),
)
