export * as VaultPlugin from "./vault.js"

import path from "path"
import { define } from "@opencode/plugin/effect/plugin"
import type { SessionID } from "@opencode/schema/session-id"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect } from "effect"
import { Location } from "../location.js"
import { Session } from "../session.js"
import { SessionMessage } from "../session/message.js"
import { Vault } from "../vault/vault.js"
import { VaultDotenv } from "../vault/dotenv.js"
import { VaultRestricted } from "../vault/restricted.js"

/**
 * Lets a client list, add, import and forget the secrets of a project, and withhold one of its user messages from
 * every later provider request; no method can return a value. Adding and importing are user actions: the model
 * has no way to call them, and `import` reads the file here, so its values never travel.
 */
export const Plugin = define({
  id: "redcode.vault",
  effect: Effect.fn(function* (ctx) {
    const vault = yield* Vault.Service
    const sessions = yield* Session.Service
    const location = yield* Location.Service
    const files = yield* FSUtil.Service
    // The Session's project, or the routed location's when a caller such as the CLI names no Session.
    const project = Effect.fnUntraced(function* (sessionID: SessionID | undefined) {
      if (sessionID === undefined) return location.project.id
      return (yield* sessions.get(sessionID)).projectID
    })
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
        set: (input) =>
          project(input.sessionID).pipe(
            Effect.flatMap((projectID) =>
              vault.set({ projectID, name: input.name, value: input.value, origin: "user" }),
            ),
            Effect.orDie,
          ),
        import: (input) =>
          Effect.gen(function* () {
            const projectID = yield* project(input.sessionID)
            const text = yield* files
              .readFileStringSafe(path.resolve(location.directory, input.path))
              .pipe(Effect.orElseSucceed(() => undefined))
            if (text === undefined) return { names: [], skipped: 0, unreadable: true }
            const parsed = VaultDotenv.parse(text)
            const names = yield* Effect.forEach(parsed.entries, (entry) =>
              vault.set({ projectID, name: entry.name, value: entry.value, origin: "user" }),
            )
            return { names, skipped: parsed.skipped }
          }).pipe(Effect.orDie),
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
