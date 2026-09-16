export * as SessionWake from "./wake"

import { Effect } from "effect"
import type { SessionSchema } from "./schema"

/**
 * How background work asks a Session to carry on.
 *
 * A monitor finishes on its own fiber, long after the tool call that started it returned. It admits
 * its result as a queued input, and then something has to make the Session drain that input;
 * otherwise the result waits until the person types something unrelated, which then runs the stale
 * result first.
 *
 * Reaching `SessionExecution` from a tool is not possible through the layer graph. Its node is
 * unbound, and the built-in tools are composed into every Location - including hosts that never run
 * Sessions (the eval harness, embedded clients, the httpapi scenarios). Declaring it as a dependency
 * makes those compositions fail to build; not declaring it makes `Effect.serviceOption` blind to it
 * even where it is bound. So the runtime that owns execution registers its wake here, and background
 * work reads it. Where nothing registers, waking is a no-op and the queued result waits for the next
 * drain, which is the correct behaviour for a host with no runner.
 *
 * Module state rather than a service, like `HumanWait`: one process, one runtime, and a tool must be
 * able to read it without taking a dependency that inverts the direction of the graph.
 */
export type Wake = (sessionID: SessionSchema.ID) => Effect.Effect<void>

let current: Wake | undefined

/** Installs the process's wake. The returned disposer removes it, so a torn-down runtime leaves none. */
export function register(wake: Wake) {
  current = wake
  return () => {
    if (current === wake) current = undefined
  }
}

/** Whether a runtime that can resume Sessions is registered. */
export function registered() {
  return current !== undefined
}

/** Asks the Session to drain. A no-op where no runtime owns execution. */
export function wake(sessionID: SessionSchema.ID): Effect.Effect<void> {
  return current ? current(sessionID) : Effect.void
}

/** Test hook: forget the registered wake. */
export function reset() {
  current = undefined
}
