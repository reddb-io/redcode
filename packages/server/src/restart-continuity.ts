import { V1Migration } from "@opencode/core/database/v1-migration"
import { RedcodePending } from "@opencode/core/session/redcode-pending"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { SessionExecution } from "@opencode/core/session/execution"
import { Effect } from "effect"

/** Finish migration and inbox admission before any suspended Session drains. */
export const resume = Effect.fn("ServerRestartContinuity.resume")(function* (
  restart: SessionRestart.Interface,
  migrate: boolean,
) {
  const execution = yield* SessionExecution.Service
  const pending = migrate
    ? yield* V1Migration.run().pipe(Effect.andThen(RedcodePending.admit()))
    : []
  yield* restart.resumeSuspendedSessions
  yield* Effect.forEach(pending, (sessionID) => execution.wake(sessionID), { discard: true })
})
