import { SessionV2 } from "@reddb-io/redcode-core/session"
import { DefaultSessionsLimit, SessionsCursor, SessionListInput } from "@reddb-io/redcode-protocol/groups/session"
import { InvalidCursorError } from "@reddb-io/redcode-protocol/errors"
import { DateTime, Effect } from "effect"

export function listSessions(session: SessionV2.Interface, input: typeof SessionListInput.Type) {
  return Effect.gen(function* () {
    const query =
      input.cursor !== undefined
        ? yield* SessionsCursor.parse(input.cursor).pipe(
            Effect.mapError(() => new InvalidCursorError({ message: "Invalid cursor" })),
          )
        : input
    const sessions = yield* session.list({
      ...query,
      workspaceID: query.workspace,
      limit: input.limit ?? DefaultSessionsLimit,
    })
    const first = sessions[0]
    const last = sessions.at(-1)
    return {
      data: sessions,
      cursor: {
        previous: first
          ? SessionsCursor.make({
              ...query,
              anchor: {
                id: first.id,
                time: DateTime.toEpochMillis(first.time.created),
                direction: "previous",
              },
            })
          : undefined,
        next: last
          ? SessionsCursor.make({
              ...query,
              anchor: {
                id: last.id,
                time: DateTime.toEpochMillis(last.time.created),
                direction: "next",
              },
            })
          : undefined,
      },
    }
  })
}

export function activeSessions(session: SessionV2.Interface) {
  return session.active.pipe(
    Effect.map((active) => ({
      data: Object.fromEntries(Array.from(active, (sessionID) => [sessionID, { type: "running" as const }])),
    })),
  )
}
