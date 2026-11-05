import { SessionRestart } from "@opencode/core/session/execution/restart"
import { Effect } from "effect"
import { Session } from "@opencode/schema/session"

/** Resume current Sessions without discovering or converting historical databases. */
export const resume = Effect.fn("ServerRestartContinuity.resume")(
  (restart: SessionRestart.Interface, recoverDelegations?: () => void) =>
    restart.resumeSuspendedSessions.pipe(Effect.tap(() => Effect.sync(() => recoverDelegations?.()))),
)

/** Foreground servers recover only the native sessions belonging to pending delegations. */
export const resumeDelegations = Effect.fn("ServerRestartContinuity.resumeDelegations")(
  (
    restart: SessionRestart.Interface,
    harness: { recoverySessions: () => ReadonlyArray<Session.ID>; recoverDelegations: () => void },
  ) =>
    restart
      .resumeSelectedSessions(harness.recoverySessions())
      .pipe(Effect.tap(() => Effect.sync(() => harness.recoverDelegations()))),
)
