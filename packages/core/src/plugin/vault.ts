export * as VaultPlugin from "./vault.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Session } from "../session.js"
import { SessionMessage } from "../session/message.js"
import { Vault } from "../vault/vault.js"
import { VaultRestricted } from "../vault/restricted.js"

/**
 * Lets a client list and forget the secrets of a Session's project, and withhold one of its user messages from every
 * later provider request; no method can return a value.
 */
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
        // Recorded in the Session metadata, never by rewriting stored events: history keeps the original text.
        withhold: (input) =>
          Effect.gen(function* () {
            const session = yield* sessions.get(input.sessionID)
            if (!input.messageID.startsWith("msg_")) return false
            const message = yield* sessions.message({
              sessionID: session.id,
              messageID: SessionMessage.ID.make(input.messageID),
            })
            if (message?.type !== "user") return false
            const metadata = VaultRestricted.mark(session.metadata, message.id, "withheld")
            if (!metadata) return false
            yield* sessions.setMetadata({ sessionID: session.id, metadata })
            return true
          }).pipe(Effect.orDie),
      })
      .pipe(Effect.orDie)
  }),
})
