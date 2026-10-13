import { Attention } from "@opencode/schema/attention"
import { SessionStore } from "@opencode/core/session/store"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Permission } from "@opencode/core/permission"
import { Form } from "@opencode/core/form"
import { Context, Effect, Option, RcMap, Result, Schema } from "effect"
import { Session } from "@opencode/schema/session"

/** Hold only existing runtimes while inspecting their requests; visiting the inbox cannot boot plugins. */
export const attention = Effect.fn("server.attention")(function* () {
  const locations = yield* LocationServiceMap.Service
  const sessions = yield* SessionStore.Service
  const refs = Array.from(yield* RcMap.keys(locations.rcMap))
  const snapshots = yield* Effect.forEach(
    refs,
    (ref) =>
      Effect.scoped(
        Effect.gen(function* () {
          const services = yield* locations.contextEffectOption(ref)
          if (Option.isNone(services)) return { data: [], unavailable: [] } satisfies Attention.Snapshot
          const permission = Context.get(services.value, Permission.Service)
          const form = Context.get(services.value, Form.Service)
          const permissions = yield* permission.list()
          const forms = yield* form.list()
          const ids = [
            ...new Set([...permissions.map((item) => item.sessionID), ...forms.map((item) => item.sessionID)]),
          ].filter(Schema.is(Session.ID))
          const entries = yield* Effect.forEach(ids, (id) =>
            Effect.gen(function* () {
              const session = yield* sessions.get(id)
              if (
                !session ||
                session.location.directory !== ref.directory ||
                session.location.workspaceID !== ref.workspaceID
              )
                return undefined
              return {
                session,
                permissions: permissions.filter((item) => item.sessionID === id),
                forms: forms.filter((item) => item.sessionID === id),
              } satisfies Attention.Entry
            }),
          )
          return { data: entries.filter((item) => item !== undefined), unavailable: [] } satisfies Attention.Snapshot
        }),
      ).pipe(
        Effect.result,
        Effect.map((result) =>
          Result.isSuccess(result) ? result.success : ({ data: [], unavailable: [ref] } satisfies Attention.Snapshot),
        ),
      ),
    { concurrency: 4 },
  )
  return {
    data: snapshots.flatMap((snapshot) => snapshot.data),
    unavailable: snapshots.flatMap((snapshot) => snapshot.unavailable),
  } satisfies Attention.Snapshot
})
