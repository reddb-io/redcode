import { Session } from "@opencode/core/session"
import { RpcSessionListInput, SessionsCursor } from "@opencode/protocol/groups/session"
import { InvalidCursorError } from "@opencode/protocol/errors"
import { DateTime, Effect } from "effect"

const DefaultSessionsLimit = 50

export const listSessions = Effect.fn("SessionRead.list")(function* (
  session: Session.Interface,
  input: typeof RpcSessionListInput.Type,
) {
  const query =
    input.cursor !== undefined
      ? yield* SessionsCursor.parse(input.cursor).pipe(
          Effect.mapError(() => new InvalidCursorError({ message: "Invalid cursor" })),
        )
      : input
  const page = yield* session.list({ ...query, limit: input.limit ?? DefaultSessionsLimit })
  const first = page.data[0]
  const last = page.data.at(-1)
  return {
    data: page.data,
    cursor: {
      previous: first
        ? SessionsCursor.make({
            ...query,
            anchor: { id: first.id, time: DateTime.toEpochMillis(first.time.updated), direction: "previous" },
          })
        : undefined,
      next: last
        ? SessionsCursor.make({
            ...query,
            anchor: { id: last.id, time: DateTime.toEpochMillis(last.time.updated), direction: "next" },
          })
        : undefined,
    },
  }
})

export const activeSessions = Effect.fn("SessionRead.active")(function* (session: Session.Interface) {
  const active = yield* session.active
  return { data: Object.fromEntries(Array.from(active, (sessionID) => [sessionID, { type: "running" as const }])) }
})
