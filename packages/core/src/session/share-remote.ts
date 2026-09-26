import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { CredentialTable } from "../credential/sql.js"
import { Integration } from "../integration.js"
import { Plugin } from "../plugin.js"
import { Credential } from "@opencode/schema/credential"
import type { Database } from "../database/database.js"
import type { SessionSchema } from "./schema.js"
import { SessionShareTable } from "./redcode.sql.js"

type DB = Database.Interface["db"]
type Share = typeof SessionShareTable.$inferSelect
export type Backend = {
  readonly resource: "share" | "shares"
  readonly baseUrl: string
  readonly headers: Record<string, string>
  readonly credentialID?: string
  readonly accountID?: string
  readonly orgID?: string
}

export const active = Effect.fn("SessionShare.activeBackend")(function* (fallback: string) {
  yield* Plugin.awaitActivation
  const integration = yield* Integration.Service
  const connection = yield* integration.connection.active(Integration.ID.make("opencode"))
  if (connection?.type === "credential") {
    const credential = yield* integration.connection.resolve(connection)
    const target = credential && credentialBackend(credential, connection.id)
    if (target) return target
  }
  return { resource: "share", baseUrl: fallback, headers: {} } satisfies Backend
})

export const backend = Effect.fn("SessionShare.backend")(function* (db: DB, share: Share) {
  if (share.resource !== "shares")
    return { resource: "share", baseUrl: new URL(share.url).origin, headers: {} } satisfies Backend
  if (share.credential_id) {
    yield* Plugin.awaitActivation
    const integration = yield* Integration.Service
    const credential = yield* integration.connection.resolve({
      type: "credential",
      id: Credential.ID.make(share.credential_id),
      label: "",
      method: "oauth",
    })
    const target = credential && credentialBackend(credential, share.credential_id, share.org_id ?? undefined)
    if (!target) return yield* Effect.fail(new Error("The credential used to create this share is unavailable"))
    return target
  }
  if (!share.account_id || !share.org_id) return yield* Effect.fail(new Error("Share account provenance is missing"))
  const linked = (yield* db.select().from(CredentialTable)
    .where(eq(CredentialTable.integration_id, Integration.ID.make("opencode")))
    .all()
    .pipe(Effect.orDie))
    .find((entry) => entry.value.metadata?.accountID === share.account_id)
  if (!linked) return yield* Effect.fail(new Error("The account used to create this share is unavailable"))
  yield* Plugin.awaitActivation
  const integration = yield* Integration.Service
  const credential = yield* integration.connection.resolve({
    type: "credential",
    id: linked.id,
    label: linked.label,
    method: linked.value.type === "oauth" ? "oauth" : "key",
  })
  const target = credential && credentialBackend(credential, linked.id, share.org_id)
  if (!target) return yield* Effect.fail(new Error("The credential used to create this share is unavailable"))
  return target
})

function credentialBackend(value: Credential.Value, credentialID: string, orgID?: string): Backend | undefined {
  const server = value.metadata?.server
  const organization = orgID ?? value.metadata?.orgID
  if (typeof server !== "string" || typeof organization !== "string") return
  return {
    resource: "shares",
    baseUrl: server,
    headers: {
      authorization: `Bearer ${value.type === "oauth" ? value.access : value.key}`,
      "x-org-id": organization,
    },
    credentialID,
    accountID: typeof value.metadata?.accountID === "string" ? value.metadata.accountID : undefined,
    orgID: organization,
  }
}

export const send = Effect.fn("SessionShare.send")(function* (
  target: Backend,
  method: "POST" | "DELETE",
  body: object,
  shareID?: string,
  sync = false,
) {
  const endpoint = `${target.baseUrl.replace(/\/$/, "")}/api/${target.resource}${shareID ? `/${encodeURIComponent(shareID)}` : ""}${sync ? "/sync" : ""}`
  return yield* Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(endpoint, {
        method,
        headers: { "content-type": "application/json", ...target.headers },
        body: JSON.stringify(body),
        signal,
      })
      if (!response.ok) throw new Error(`Share service returned HTTP ${response.status}`)
      if (shareID) return
      return response.json() as Promise<unknown>
    },
    catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
  })
})

/** Revoke before deleting a Session, while its share secret is still in the database. */
export const revoke = Effect.fn("SessionShare.revoke")(function* (db: DB, sessionID: SessionSchema.ID) {
  const share = yield* db
    .select()
    .from(SessionShareTable)
    .where(eq(SessionShareTable.session_id, sessionID))
    .get()
    .pipe(Effect.orDie)
  if (!share) return
  yield* send(yield* backend(db, share), "DELETE", { secret: share.secret }, share.id)
})
