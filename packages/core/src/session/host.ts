export * as SessionHost from "./host"

import type { Effect } from "effect"
import type { SessionV2 } from "../session"
import type { SessionSchema } from "./schema"

/**
 * The Session operations a subagent needs from inside a tool call.
 *
 * The `task` tool creates a child Session, admits its prompt durably and waits for its drain. Those
 * belong to `SessionV2.Service` and `SessionExecution.Service`, which a built-in tool cannot take as
 * layer dependencies: the built-in tools are composed into every Location, including hosts that
 * never run Sessions, and the execution node is unbound there (see `SessionWake`). So the runtime
 * that owns Sessions registers these operations here when it starts, and the tool reads them. Where
 * nothing registered, a subagent cannot run and the tool says so.
 *
 * Module state rather than a service, like `SessionWake`: one process, one runtime.
 */
export interface Host {
  readonly create: SessionV2.Interface["create"]
  readonly prompt: SessionV2.Interface["prompt"]
  /** Starts a drain while idle, or joins the active one, and waits until it settles. */
  readonly resume: SessionV2.Interface["resume"]
  /** Interrupts the Session's active drain; a no-op while idle. */
  readonly interrupt: SessionV2.Interface["interrupt"]
  /** Asks the Session to drain newly recorded work without waiting for it. */
  readonly wake: (sessionID: SessionSchema.ID) => Effect.Effect<void>
}

let current: Host | undefined

/** Installs the process's host. The returned disposer removes it, so a torn-down runtime leaves none. */
export function register(host: Host) {
  current = host
  return () => {
    if (current === host) current = undefined
  }
}

/** The registered host, or nothing where no runtime runs Sessions. */
export function get() {
  return current
}
