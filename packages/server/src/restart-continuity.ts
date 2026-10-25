import { SessionRestart } from "@opencode/core/session/execution/restart"
import { Effect } from "effect"

/** Resume current Sessions without discovering or converting historical databases. */
export const resume = Effect.fn("ServerRestartContinuity.resume")(
  (restart: SessionRestart.Interface) => restart.resumeSuspendedSessions,
)
