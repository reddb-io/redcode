export * as ExecutionOwner from "./execution-owner.js"

import { randomUUID } from "node:crypto"
import { Effect, Schema } from "effect"
import { ExecutionOwnerPlatform } from "#execution-owner-platform"

export const Info = Schema.Struct({ token: Schema.String, pid: Schema.Int, host: Schema.String, boot: Schema.Number })
export type Info = typeof Info.Type

const local = new Set<string>()

/** One runtime identity per owning service scope, including multiple runtimes in one process. */
export const make = Effect.gen(function* () {
  const owner = { token: randomUUID(), ...ExecutionOwnerPlatform.identity }
  local.add(owner.token)
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      local.delete(owner.token)
    }),
  )
  return owner
})

export function alive(owner: Info) {
  return ExecutionOwnerPlatform.alive(owner, local.has(owner.token))
}
