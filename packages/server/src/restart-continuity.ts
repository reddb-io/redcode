import { V1Migration } from "@opencode/core/database/v1-migration"
import { RedcodePending } from "@opencode/core/session/redcode-pending"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { SessionExecution } from "@opencode/core/session/execution"
import { Effect } from "effect"
import { Global } from "@opencode/util/global"
import path from "node:path"

declare const OPENCODE_ARTIFACT: string | undefined

/** Finish migration and inbox admission before any suspended Session drains. */
export const resume = Effect.fn("ServerRestartContinuity.resume")(function* (
  restart: SessionRestart.Interface,
  migrate: boolean,
) {
  const execution = yield* SessionExecution.Service
  if (migrate) {
    yield* V1Migration.run()
    if (typeof OPENCODE_ARTIFACT === "string" && OPENCODE_ARTIFACT === "redcode")
      yield* V1Migration.importRedcodeOnce(path.join((yield* Global.Service).data, "redcode.db"))
  }
  const pending = yield* RedcodePending.admit({ onError: "continue" })
  yield* restart.resumeSuspendedSessions
  yield* Effect.forEach(pending, (sessionID) => execution.wake(sessionID), { discard: true })
})
