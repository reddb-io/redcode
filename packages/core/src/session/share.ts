export * as SessionShare from "./share.js"

import { eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema, Stream } from "effect"
import { HttpClient } from "effect/unstable/http"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { Config } from "../config.js"
import { ConsoleOrganization } from "../console-organization.js"
import { Credential } from "../credential.js"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { LocationServiceMap } from "../location-service-map.js"
import { Plugin } from "../plugin.js"
import { Session } from "../session.js"
import { SessionEvent } from "./event.js"
import { SessionMessage } from "./message.js"
import { SessionShareTable } from "./redcode.sql.js"
import { active, backend, revoke, send } from "./share-remote.js"
import { SessionSchema } from "./schema.js"
import { SessionTable } from "./sql.js"

const RemoteShare = Schema.Struct({ id: Schema.String, url: Schema.String, secret: Schema.String })
const encodeSession = Schema.encodeSync(SessionSchema.Info)
const encodeMessages = Schema.encodeSync(Schema.Array(SessionMessage.Info))

export interface Interface {
  readonly create: (sessionID: SessionSchema.ID) => Effect.Effect<SessionSchema.Info, Error>
  readonly remove: (sessionID: SessionSchema.ID) => Effect.Effect<SessionSchema.Info, Error>
  readonly sync: (sessionID: SessionSchema.ID) => Effect.Effect<void, Error>
  readonly rebind: (sessionID: SessionSchema.ID, credentialID: Credential.ID, orgID: string) => Effect.Effect<SessionSchema.Info, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionShare") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const database = yield* Database.Service
    const locations = yield* LocationServiceMap.Service
    const sessions = yield* Session.Service
    const http = yield* HttpClient.HttpClient
    const pending = new Set<SessionSchema.ID>()

    const settings = Effect.fn("SessionShare.settings")(function* (info: SessionSchema.Info) {
      return yield* Effect.gen(function* () {
        const config = yield* Config.Service
        const entries = yield* config.entries()
        return {
          mode: Config.latest(entries, "share") ?? "manual",
          url: Config.latest(entries, "enterprise")?.url ?? "https://opncd.ai",
        }
      }).pipe(
        Effect.provide(locations.get(info.location)),
      )
    })

    const stored = Effect.fn("SessionShare.stored")(function* (sessionID: SessionSchema.ID) {
      return yield* database.db
        .select()
        .from(SessionShareTable)
        .where(eq(SessionShareTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie)
    })

    const sync = Effect.fn("SessionShare.sync")(function* (sessionID: SessionSchema.ID) {
      const share = yield* stored(sessionID)
      if (!share) return
      const info = yield* sessions.get(sessionID)
      const messages = (yield* sessions.messages({ sessionID, order: "asc" })).filter(
        (message) => message.type !== "system" && message.type !== "skill" && message.type !== "synthetic",
      )
      const summary = yield* database.db
        .select({ diffs: SessionTable.summary_diffs })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(Effect.orDie)
      const diffs = summary?.diffs
        ? summary.diffs.filter((diff) => diff.file !== undefined && diff.patch !== undefined)
        : yield* sessions.diff({ sessionID }).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("share diff unavailable", { sessionID, cause }).pipe(Effect.as([])),
            ),
          )
      const data = [
        { type: "session", data: encodeSession({ ...info, permissions: undefined, metadata: undefined, revert: undefined }) },
        { type: "messages", data: { sessionID, messages: encodeMessages(messages) } },
        { type: "session_diff", data: diffs },
      ]
      const target = yield* backend(database.db, share).pipe(Effect.provide(locations.get(info.location)))
      yield* send(target, "POST", {
        secret: share.secret,
        data,
      }, share.id, true)
    })

    const create = Effect.fn("SessionShare.create")(function* (sessionID: SessionSchema.ID) {
      const info = yield* sessions.get(sessionID)
      const config = yield* settings(info)
      if (process.env["REDCODE_DISABLE_SHARE"] === "true" || process.env["REDCODE_DISABLE_SHARE"] === "1")
        return yield* Effect.fail(new Error("Sharing is disabled"))
      if (config.mode === "disabled") return yield* Effect.fail(new Error("Sharing is disabled by configuration"))
      const existing = yield* stored(sessionID)
      if (existing) {
        yield* sync(sessionID)
        return yield* sessions.get(sessionID)
      }
      if (info.share) return yield* Effect.fail(new Error("The existing share has no local secret"))
      const target = yield* active(config.url).pipe(Effect.provide(locations.get(info.location)))
      const share = yield* Schema.decodeUnknownEffect(RemoteShare)(yield* send(target, "POST", { sessionID })).pipe(
        Effect.mapError(() => new Error("Share service returned an invalid link")),
      )
      yield* database.db
        .insert(SessionShareTable)
        .values({
          session_id: sessionID,
          id: share.id,
          secret: share.secret,
          url: share.url,
          resource: target.resource,
          credential_id: target.credentialID,
          account_id: target.accountID,
          org_id: target.orgID,
        })
        .run()
        .pipe(Effect.orDie)
      yield* sync(sessionID)
      yield* database.db
        .update(SessionTable)
        .set({ share_url: share.url })
        .where(eq(SessionTable.id, sessionID))
        .run()
        .pipe(Effect.orDie)
      return yield* sessions.get(sessionID)
    })

    const remove = Effect.fn("SessionShare.remove")(function* (sessionID: SessionSchema.ID) {
      const info = yield* sessions.get(sessionID)
      const share = yield* stored(sessionID)
      if (!share) {
        if (info.share) return yield* Effect.fail(new Error("The existing share has no local secret"))
        return info
      }
      yield* revoke(database.db, sessionID).pipe(Effect.provide(locations.get(info.location)))
      yield* database.db.transaction(() =>
        Effect.gen(function* () {
          yield* database.db.delete(SessionShareTable).where(eq(SessionShareTable.session_id, sessionID)).run()
          yield* database.db.update(SessionTable).set({ share_url: null }).where(eq(SessionTable.id, sessionID)).run()
        }),
      ).pipe(Effect.orDie)
      return yield* sessions.get(sessionID)
    })

    const rebind = Effect.fn("SessionShare.rebind")(function* (
      sessionID: SessionSchema.ID,
      credentialID: Credential.ID,
      orgID: string,
    ) {
      const info = yield* sessions.get(sessionID)
      const share = yield* stored(sessionID)
      if (!share) return yield* Effect.fail(new Error("This session has no recoverable local share secret"))
      if (share.resource !== "share" || share.credential_id || share.account_id || share.org_id)
        return yield* Effect.fail(new Error("This share already has backend provenance"))
      yield* Plugin.awaitActivation.pipe(Effect.provide(locations.get(info.location)))
      const account = (yield* ConsoleOrganization.list(credentialID).pipe(
        Effect.provide(locations.get(info.location)),
        Effect.provideService(HttpClient.HttpClient, http),
      ))[0]
      if (!account) return yield* Effect.fail(new Error(`Console account not found: ${credentialID}`))
      if (!account.orgs.some((org) => org.id === orgID))
        return yield* Effect.fail(new Error(`Console organization not found: ${orgID}`))

      yield* database.db
        .update(SessionShareTable)
        .set({ resource: "shares", credential_id: credentialID, org_id: orgID })
        .where(eq(SessionShareTable.session_id, sessionID))
        .run()
        .pipe(Effect.orDie)
      yield* sync(sessionID).pipe(
        Effect.tapError(() =>
          database.db
            .update(SessionShareTable)
            .set({ resource: share.resource, credential_id: share.credential_id, org_id: share.org_id })
            .where(eq(SessionShareTable.session_id, sessionID))
            .run()
            .pipe(Effect.orDie),
        ),
      )
      return yield* sessions.get(sessionID)
    })

    yield* bus
      .subscribe([
        SessionEvent.Created,
        SessionEvent.InboxDelivered,
        SessionEvent.Renamed,
        SessionEvent.Moved,
        SessionEvent.Step.Ended,
        SessionEvent.Step.Failed,
        SessionEvent.Execution.Succeeded,
        SessionEvent.Execution.Failed,
        SessionEvent.Execution.Interrupted,
      ])
      .pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            const sessionID = event.data.sessionID
            if (pending.has(sessionID)) return
            pending.add(sessionID)
            yield* Effect.gen(function* () {
              yield* Effect.sleep("1 second")
              pending.delete(sessionID)
              if (event.type === SessionEvent.Created.type) {
                const info = yield* sessions.get(sessionID)
                if ((yield* settings(info)).mode === "auto") yield* create(sessionID)
                return
              }
              yield* sync(sessionID)
            }).pipe(
              Effect.catchCause((cause) => Effect.logWarning("share synchronization failed", { sessionID, cause })),
              Effect.ensuring(Effect.sync(() => pending.delete(sessionID))),
              Effect.forkScoped,
            )
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )

    return Service.of({ create, remove, sync, rebind })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Bus.node, Database.node, LocationServiceMap.node, Session.node, httpClient],
})
