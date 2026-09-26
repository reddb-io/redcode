import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { AccountStateTable, AccountTable } from "../account/sql.js"
import type { Database } from "../database/database.js"
import type { SessionSchema } from "./schema.js"
import { SessionShareTable } from "./redcode.sql.js"

const Token = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
  expires_in: Schema.Number,
})

type DB = Database.Interface["db"]
type Share = typeof SessionShareTable.$inferSelect
export type Backend = {
  readonly resource: "share" | "shares"
  readonly baseUrl: string
  readonly headers: Record<string, string>
  readonly accountID?: string
  readonly orgID?: string
}

export const active = Effect.fn("SessionShare.activeBackend")(function* (db: DB, fallback: string) {
  const state = yield* db.select().from(AccountStateTable).where(eq(AccountStateTable.id, 1)).get().pipe(Effect.orDie)
  if (!state?.active_account_id || !state.active_org_id)
    return { resource: "share", baseUrl: fallback, headers: {} } satisfies Backend
  const account = yield* db
    .select()
    .from(AccountTable)
    .where(eq(AccountTable.id, state.active_account_id))
    .get()
    .pipe(Effect.orDie)
  if (!account) return { resource: "share", baseUrl: fallback, headers: {} } satisfies Backend
  return {
    resource: "shares",
    baseUrl: account.url,
    headers: {
      authorization: `Bearer ${yield* token(db, account)}`,
      "x-org-id": state.active_org_id,
    },
    accountID: account.id,
    orgID: state.active_org_id,
  } satisfies Backend
})

export const backend = Effect.fn("SessionShare.backend")(function* (db: DB, share: Share) {
  if (share.resource !== "shares")
    return { resource: "share", baseUrl: new URL(share.url).origin, headers: {} } satisfies Backend
  if (!share.account_id || !share.org_id) return yield* Effect.fail(new Error("Share account provenance is missing"))
  const account = yield* db
    .select()
    .from(AccountTable)
    .where(eq(AccountTable.id, share.account_id))
    .get()
    .pipe(Effect.orDie)
  if (!account) return yield* Effect.fail(new Error("The account used to create this share is unavailable"))
  return {
    resource: "shares",
    baseUrl: account.url,
    headers: {
      authorization: `Bearer ${yield* token(db, account)}`,
      "x-org-id": share.org_id,
    },
    accountID: account.id,
    orgID: share.org_id,
  } satisfies Backend
})

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

const token = Effect.fn("SessionShare.token")(function* (db: DB, account: typeof AccountTable.$inferSelect) {
  if (account.token_expiry && account.token_expiry > Date.now() + 5 * 60_000) return account.access_token
  const renewed = yield* Schema.decodeUnknownEffect(Token)(
    yield* Effect.tryPromise({
      try: async (signal) => {
        const response = await fetch(`${account.url.replace(/\/$/, "")}/auth/device/token`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            grant_type: "refresh_token",
            refresh_token: account.refresh_token,
            client_id: "opencode-cli",
          }),
          signal,
        })
        if (!response.ok) throw new Error(`Account token refresh returned HTTP ${response.status}`)
        return response.json() as Promise<unknown>
      },
      catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
    }),
  ).pipe(Effect.mapError(() => new Error("Account token refresh returned invalid credentials")))
  yield* db
    .update(AccountTable)
    .set({
      access_token: renewed.access_token,
      refresh_token: renewed.refresh_token,
      token_expiry: Date.now() + renewed.expires_in * 1000,
    })
    .where(eq(AccountTable.id, account.id))
    .run()
    .pipe(Effect.orDie)
  return renewed.access_token
})
