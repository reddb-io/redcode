export * as SessionWait from "./wait.js"

import { Effect } from "effect"
import { SessionWait } from "@opencode/schema/session-wait"
import { Bus } from "../bus.js"
import { KeyedMutex } from "../effect/keyed-mutex.js"
import type { SessionSchema } from "./schema.js"

// Execution ownership is process-local; these transient observations live only as long as their work.
const active = new Map<string, Map<string, SessionWait.Info>>()
const locks = KeyedMutex.makeUnsafe<string>()

export function list(sessionID: string): readonly SessionWait.Info[] {
  return [...(active.get(sessionID)?.values() ?? [])]
}

export function start(
  bus: Pick<Bus.Interface, "publish">,
  input: {
    sessionID: SessionSchema.ID
    kind: SessionWait.Info["kind"]
    target?: string
  },
) {
  return Effect.uninterruptible(
    Effect.gen(function* () {
      const wait: SessionWait.Info = {
        id: crypto.randomUUID(),
        kind: input.kind,
        started: Date.now(),
        ...(input.target ? { target: input.target } : {}),
      }
      const entries = active.get(input.sessionID) ?? new Map<string, SessionWait.Info>()
      entries.set(wait.id, wait)
      active.set(input.sessionID, entries)
      const publish = () =>
        bus.publish(SessionWait.Changed, { sessionID: input.sessionID, waits: list(input.sessionID) })
      yield* publish().pipe(
        Effect.onError(() =>
          Effect.sync(() => {
            entries.delete(wait.id)
            if (!entries.size && active.get(input.sessionID) === entries) active.delete(input.sessionID)
          }),
        ),
      )
      return Effect.suspend(() => {
        if (!entries.delete(wait.id)) return Effect.void
        if (!entries.size && active.get(input.sessionID) === entries) active.delete(input.sessionID)
        return publish()
      }).pipe(locks.withLock(input.sessionID), Effect.uninterruptible)
    }),
  ).pipe(locks.withLock(input.sessionID))
}
