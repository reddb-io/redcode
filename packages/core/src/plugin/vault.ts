export * as VaultPlugin from "./vault.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Session } from "../session.js"
import { Vault } from "../vault/vault.js"

/** Lets a client list and forget the secrets of a Session's project; no method can return a value. */
export const Plugin = define({
  id: "redcode.vault",
  effect: Effect.fn(function* (ctx) {
    const vault = yield* Vault.Service
    const sessions = yield* Session.Service
    yield* ctx.rpc
      .register(Vault.Definition, {
        list: (input) =>
          sessions.get(input.sessionID).pipe(
            Effect.flatMap((session) => vault.list(session.projectID)),
            Effect.orDie,
          ),
        forget: (input) =>
          sessions.get(input.sessionID).pipe(
            Effect.flatMap((session) => vault.forget({ projectID: session.projectID, name: input.name })),
            Effect.orDie,
          ),
      })
      .pipe(Effect.orDie)
  }),
})
