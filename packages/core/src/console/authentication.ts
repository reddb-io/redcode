export * as ConsoleAuthentication from "./authentication.js"

import { Console } from "@opencode/schema/console"
import { Credential } from "@opencode/schema/credential"
import { Context, Effect, Layer } from "effect"
import { and, eq, inArray, or } from "drizzle-orm"
import { authenticate } from "../console.js"
import { Database } from "../database/database.js"
import { CredentialTable } from "../credential/sql.js"
import { MemberTable, FederationAttemptTable, AuditTable } from "./sql.js"
import { OwnerMemberTable, InfrastructureAuditTable } from "./infrastructure.sql.js"
import { AuthProviderTable, AuthSettingTable } from "./authentication.sql.js"

type Store = Pick<Database.Interface["db"], "select" | "insert" | "update" | "delete">
const query = <A>(effect: Effect.Effect<A, unknown>) => effect.pipe(Effect.orDie)
const failure = (code: Console.Failure["code"], message: string) => new Console.Failure({ code, message })
export function url(value: string, origin = false) {
  const result = new URL(value)
  if (
    result.username ||
    result.password ||
    result.search ||
    result.hash ||
    (origin && result.pathname !== "/") ||
    (result.protocol !== "https:" &&
      !(result.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(result.hostname)))
  )
    throw new Error("Use HTTPS, or loopback HTTP for local development. Do not include credentials, query or fragment.")
  return origin || result.pathname === "/" ? result.origin : result.href
}
const view = (row: typeof AuthProviderTable.$inferSelect): Console.AuthProvider => ({
  id: row.id,
  name: row.name,
  issuer: row.issuer,
  clientID: row.client_id,
  tokenAuthMethod: row.token_auth_method,
  hasSecret: !!row.credential_id,
  enabled: row.enabled,
  scope: row.scope_kind,
  scopeID: row.scope_id,
})
const admin = Effect.fn("ConsoleAuthentication.admin")(function* (
  store: Store,
  token: string,
  scope: Console.AuthScope,
  scopeID: string,
) {
  const actor = yield* authenticate(store, token)
  if (scope === "organization") {
    const member = yield* query(
      store
        .select()
        .from(MemberTable)
        .where(and(eq(MemberTable.organization_id, scopeID), eq(MemberTable.account_id, actor.account.id)))
        .get(),
    )
    if (!member || member.role === "member")
      return yield* failure("forbidden", "Organization administrator access required")
    return actor
  }
  if (scope === "global" && scopeID !== "installation") return yield* failure("invalid", "Invalid installation scope")
  const member = yield* query(
    store
      .select()
      .from(OwnerMemberTable)
      .where(
        and(
          eq(OwnerMemberTable.account_id, actor.account.id),
          eq(OwnerMemberTable.role, "admin"),
          ...(scope === "infrastructure" ? [eq(OwnerMemberTable.owner_id, scopeID)] : []),
        ),
      )
      .get(),
  )
  if (!member) return yield* failure("forbidden", "Infrastructure administrator access required")
  return actor
})
const audit = Effect.fn("ConsoleAuthentication.audit")(function* (
  store: Store,
  accountID: string,
  scope: Console.AuthScope,
  scopeID: string,
  action: string,
  resourceID: string,
) {
  const data = { id: crypto.randomUUID(), actor_id: accountID, action, resource_id: resourceID, created_at: Date.now() }
  if (scope === "organization") {
    yield* query(
      store
        .insert(AuditTable)
        .values({ ...data, organization_id: scopeID })
        .run(),
    )
    return
  }
  const member = yield* query(
    store
      .select()
      .from(OwnerMemberTable)
      .where(
        and(
          eq(OwnerMemberTable.account_id, accountID),
          eq(OwnerMemberTable.role, "admin"),
          ...(scope === "infrastructure" ? [eq(OwnerMemberTable.owner_id, scopeID)] : []),
        ),
      )
      .get(),
  )
  if (member)
    yield* query(
      store
        .insert(InfrastructureAuditTable)
        .values({ ...data, owner_id: member.owner_id })
        .run(),
    )
})
const make = Effect.fn("ConsoleAuthentication.make")(function* () {
  const db = (yield* Database.Service).db
  const transaction = <A>(body: (store: Store) => Effect.Effect<A, Console.Failure>) =>
    db.transaction(body, { behavior: "immediate" }).pipe(Effect.catchTag("SqlError", Effect.die))
  const belongs = (scope: Console.AuthScope, scopeID: string) =>
    and(eq(AuthProviderTable.scope_kind, scope), eq(AuthProviderTable.scope_id, scopeID))
  return {
    settings: (token: string, scope: Console.AuthScope, scopeID: string) =>
      Effect.gen(function* () {
        yield* admin(db, token, scope, scopeID)
        const setting = yield* query(
          db.select().from(AuthSettingTable).where(eq(AuthSettingTable.id, "installation")).get(),
        )
        const providers = yield* query(db.select().from(AuthProviderTable).where(belongs(scope, scopeID)).all())
        const inherited =
          scope === "global"
            ? []
            : yield* query(
                db
                  .select()
                  .from(AuthProviderTable)
                  .where(and(eq(AuthProviderTable.scope_kind, "global"), eq(AuthProviderTable.enabled, true)))
                  .all(),
              )
        return {
          ...(setting ? { publicURL: setting.public_url } : {}),
          providers: providers.map(view),
          inherited: inherited.map(({ id, name, issuer }) => ({ id, name, issuer })),
        }
      }),
    setURL: (token: string, publicURL: string) =>
      Effect.gen(function* () {
        const normalized = yield* Effect.try({
          try: () => url(publicURL, true),
          catch: () => failure("invalid", "Enter a valid public Console origin using HTTPS or local loopback HTTP"),
        })
        yield* transaction((store) =>
          Effect.gen(function* () {
            const actor = yield* admin(store, token, "global", "installation")
            yield* query(
              store
                .insert(AuthSettingTable)
                .values({ id: "installation", public_url: normalized })
                .onConflictDoUpdate({ target: AuthSettingTable.id, set: { public_url: normalized } })
                .run(),
            )
            yield* query(store.delete(FederationAttemptTable).run())
            yield* audit(
              store,
              actor.account.id,
              "global",
              "installation",
              "authentication.origin.updated",
              "installation",
            )
          }),
        )
      }),
    save: (
      token: string,
      scope: Console.AuthScope,
      scopeID: string,
      input: Console.AuthProviderInput,
      providerID?: string,
    ) =>
      Effect.gen(function* () {
        const issuer = yield* Effect.try({
          try: () => url(input.issuer),
          catch: () => failure("invalid", "Enter a valid issuer using HTTPS or local loopback HTTP"),
        })
        return yield* transaction((store) =>
          Effect.gen(function* () {
            const actor = yield* admin(store, token, scope, scopeID)
            const setting = yield* query(
              store.select().from(AuthSettingTable).where(eq(AuthSettingTable.id, "installation")).get(),
            )
            if (!setting)
              return yield* failure("invalid", "An infrastructure administrator must set the Console public URL first")
            const current = providerID
              ? yield* query(
                  store
                    .select()
                    .from(AuthProviderTable)
                    .where(and(belongs(scope, scopeID), eq(AuthProviderTable.id, providerID)))
                    .get(),
                )
              : undefined
            if (providerID && !current) return yield* failure("not_found", "Identity provider not found in this scope")
            if (
              current &&
              (current.issuer !== issuer || current.client_id !== input.clientID) &&
              input.tokenAuthMethod !== "none" &&
              !input.clientSecret
            )
              return yield* failure("invalid", "Enter a new client secret when changing issuer or client ID")
            const credentialID =
              input.tokenAuthMethod === "none"
                ? null
                : current?.credential_id || (input.clientSecret ? Credential.ID.create() : null)
            if (input.tokenAuthMethod !== "none" && !credentialID)
              return yield* failure("invalid", "Client secret is required for a confidential client")
            if (input.tokenAuthMethod === "none" && input.clientSecret)
              return yield* failure("invalid", "Public clients do not use a client secret")
            if (credentialID && input.clientSecret)
              yield* query(
                store
                  .insert(CredentialTable)
                  .values({
                    id: credentialID,
                    label: "Console identity provider",
                    value: { type: "key", key: input.clientSecret },
                    active: false,
                  })
                  .onConflictDoUpdate({
                    target: CredentialTable.id,
                    set: { value: { type: "key", key: input.clientSecret } },
                  })
                  .run(),
              )
            if (current?.credential_id && !credentialID)
              yield* query(store.delete(CredentialTable).where(eq(CredentialTable.id, current.credential_id)).run())
            const row = {
              id: providerID || crypto.randomUUID(),
              scope_kind: scope,
              scope_id: scopeID,
              name: input.name,
              issuer,
              client_id: input.clientID,
              token_auth_method: input.tokenAuthMethod,
              credential_id: credentialID,
              enabled: input.enabled,
            }
            yield* query(
              store
                .insert(AuthProviderTable)
                .values(row)
                .onConflictDoUpdate({ target: AuthProviderTable.id, set: row })
                .run(),
            )
            yield* query(
              store.delete(FederationAttemptTable).where(eq(FederationAttemptTable.provider_id, row.id)).run(),
            )
            yield* audit(
              store,
              actor.account.id,
              scope,
              scopeID,
              current ? "authentication.provider.updated" : "authentication.provider.created",
              row.id,
            )
            return view(row)
          }),
        )
      }),
    remove: (token: string, scope: Console.AuthScope, scopeID: string, providerID: string) =>
      transaction((store) =>
        Effect.gen(function* () {
          const actor = yield* admin(store, token, scope, scopeID)
          const current = yield* query(
            store
              .select()
              .from(AuthProviderTable)
              .where(and(belongs(scope, scopeID), eq(AuthProviderTable.id, providerID)))
              .get(),
          )
          if (!current) return yield* failure("not_found", "Identity provider not found in this scope")
          yield* query(store.delete(AuthProviderTable).where(eq(AuthProviderTable.id, current.id)).run())
          yield* query(
            store.delete(FederationAttemptTable).where(eq(FederationAttemptTable.provider_id, current.id)).run(),
          )
          if (current.credential_id)
            yield* query(store.delete(CredentialTable).where(eq(CredentialTable.id, current.credential_id)).run())
          yield* audit(store, actor.account.id, scope, scopeID, "authentication.provider.removed", current.id)
        }),
      ),
    publicProviders: (token: string, organizationID?: string, ownerID?: string, account = false) =>
      Effect.gen(function* () {
        if (organizationID && ownerID)
          return yield* failure("invalid", "Choose an organization or infrastructure scope")
        const conditions = [eq(AuthProviderTable.scope_kind, "global")]
        if (organizationID) conditions.push(belongs("organization", organizationID)!)
        if (ownerID) conditions.push(belongs("infrastructure", ownerID)!)
        if (account) {
          const actor = yield* authenticate(db, token)
          const members = yield* query(
            db.select().from(MemberTable).where(eq(MemberTable.account_id, actor.account.id)).all(),
          )
          const owners = yield* query(
            db.select().from(OwnerMemberTable).where(eq(OwnerMemberTable.account_id, actor.account.id)).all(),
          )
          if (members.length)
            conditions.push(
              and(
                eq(AuthProviderTable.scope_kind, "organization"),
                inArray(
                  AuthProviderTable.scope_id,
                  members.map((item) => item.organization_id),
                ),
              )!,
            )
          if (owners.length)
            conditions.push(
              and(
                eq(AuthProviderTable.scope_kind, "infrastructure"),
                inArray(
                  AuthProviderTable.scope_id,
                  owners.map((item) => item.owner_id),
                ),
              )!,
            )
        }
        const rows = yield* query(
          db
            .select()
            .from(AuthProviderTable)
            .where(and(eq(AuthProviderTable.enabled, true), or(...conditions)))
            .all(),
        )
        return rows.map(({ id, name, issuer }) => ({ id, name, issuer }))
      }),
    runtime: () =>
      Effect.gen(function* () {
        const setting = yield* query(
          db.select().from(AuthSettingTable).where(eq(AuthSettingTable.id, "installation")).get(),
        )
        const rows = yield* query(db.select().from(AuthProviderTable).where(eq(AuthProviderTable.enabled, true)).all())
        const providers = yield* Effect.forEach(rows, (row) =>
          Effect.gen(function* () {
            const credential = row.credential_id
              ? yield* query(db.select().from(CredentialTable).where(eq(CredentialTable.id, row.credential_id)).get())
              : undefined
            return {
              id: row.id,
              name: row.name,
              issuer: row.issuer,
              clientID: row.client_id,
              tokenAuthMethod: row.token_auth_method,
              ...(credential?.value.type === "key" ? { clientSecret: credential.value.key } : {}),
              scope: row.scope_kind,
              scopeID: row.scope_id,
            }
          }),
        )
        return { publicURL: setting?.public_url, providers }
      }),
  }
})
export type Interface = Effect.Success<ReturnType<typeof make>>
export class Service extends Context.Service<Service, Interface>()("@redcode/ConsoleAuthentication") {}
export const layer = Layer.effect(Service, make())
