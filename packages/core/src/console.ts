export * as Console from "./console.js"

import { Console } from "@opencode/schema/console"
import { and, desc, eq, lte, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Database } from "./database/database.js"
import { ConsoleCrypto } from "./console/crypto.js"
import { AuthProviderTable } from "./console/authentication.sql.js"
import { OwnerTable, OwnerMemberTable } from "./console/infrastructure.sql.js"
import {
  AccountTable,
  IdentityTable,
  FederationAttemptTable,
  AuditTable,
  InviteTable,
  KeyTable,
  MemberTable,
  OrganizationTable,
  SessionTable,
  WorkspaceTable,
} from "./console/sql.js"

type Store = Pick<Database.Interface["db"], "select" | "insert" | "update" | "delete">
const query = <A>(effect: Effect.Effect<A, unknown>) => effect.pipe(Effect.orDie)
const failure = (code: Console.Failure["code"], message: string) => new Console.Failure({ code, message })
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`
const email = (value: string) => value.trim().toLowerCase()
const accountInfo = (row: typeof AccountTable.$inferSelect): Console.Account => ({
  id: row.id,
  email: row.email,
  name: row.name,
  createdAt: row.created_at,
  localPassword: row.password_hash !== "",
})
const workspaceInfo = (row: typeof WorkspaceTable.$inferSelect): Console.Workspace => ({
  id: row.id,
  organizationID: row.organization_id,
  name: row.name,
  createdAt: row.created_at,
})
const inviteInfo = (row: typeof InviteTable.$inferSelect): Console.Invite => ({
  id: row.id,
  email: row.email,
  role: row.role,
  expiresAt: row.expires_at,
})
const keyInfo = (row: typeof KeyTable.$inferSelect): Console.Key => ({
  id: row.id,
  workspaceID: row.workspace_id,
  accountID: row.account_id,
  name: row.name,
  prefix: row.prefix,
  createdAt: row.created_at,
  ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
})

export const authenticate = Effect.fn("Console.authenticate")(function* (store: Store, token: string) {
  const hash = yield* Effect.promise(() => ConsoleCrypto.digest(token))
  const row = yield* query(
    store
      .select({ account: AccountTable, expires: SessionTable.expires_at })
      .from(SessionTable)
      .innerJoin(AccountTable, eq(AccountTable.id, SessionTable.account_id))
      .where(eq(SessionTable.token_hash, hash))
      .get(),
  )
  if (!row || row.expires <= Date.now()) return yield* failure("unauthorized", "Sign in to the Redcode Console")
  return { account: row.account, hash, expiresAt: row.expires }
})

const access = Effect.fn("Console.access")(function* (
  store: Store,
  token: string,
  organizationID: string,
  roles?: readonly Console.Role[],
) {
  const actor = yield* authenticate(store, token)
  const membership = yield* query(
    store
      .select()
      .from(MemberTable)
      .where(and(eq(MemberTable.organization_id, organizationID), eq(MemberTable.account_id, actor.account.id)))
      .get(),
  )
  if (!membership || (roles && !roles.includes(membership.role)))
    return yield* failure("forbidden", "You do not have permission to access this organization")
  return { ...actor, role: membership.role }
})

const workspaceAccess = Effect.fn("Console.workspaceAccess")(function* (
  store: Store,
  token: string,
  workspaceID: string,
) {
  const workspace = yield* query(store.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceID)).get())
  if (!workspace) return yield* failure("not_found", "Workspace not found")
  const actor = yield* access(store, token, workspace.organization_id)
  return { ...actor, workspace }
})

function audit(store: Store, organizationID: string, actorID: string, action: string, resourceID: string) {
  return query(
    store
      .insert(AuditTable)
      .values({
        id: id("rdcaudit"),
        organization_id: organizationID,
        actor_id: actorID,
        action,
        resource_id: resourceID,
        created_at: Date.now(),
      })
      .run(),
  )
}

const issueSession = Effect.fn("Console.issueSession")(function* (
  store: Store,
  account: typeof AccountTable.$inferSelect,
  token: string,
  hash: string,
  ttl = 7 * 24 * 60 * 60 * 1000,
) {
  const expiresAt = Date.now() + ttl
  yield* query(
    store.insert(SessionTable).values({ token_hash: hash, account_id: account.id, expires_at: expiresAt }).run(),
  )
  return { token, expiresAt, account: accountInfo(account) }
})

const preserveOwner = Effect.fn("Console.preserveOwner")(function* (
  store: Store,
  organizationID: string,
  accountID: string,
) {
  const member = yield* query(
    store
      .select()
      .from(MemberTable)
      .where(and(eq(MemberTable.organization_id, organizationID), eq(MemberTable.account_id, accountID)))
      .get(),
  )
  if (!member) return yield* failure("not_found", "Member not found")
  if (member.role === "owner") {
    const owners = yield* query(
      store
        .select({ count: sql<number>`count(*)` })
        .from(MemberTable)
        .where(and(eq(MemberTable.organization_id, organizationID), eq(MemberTable.role, "owner")))
        .get(),
    )
    if (!owners || owners.count <= 1)
      return yield* failure("conflict", "Transfer ownership before removing the last owner")
  }
  return member
})

const revokeMemberKeys = Effect.fn("Console.revokeMemberKeys")(function* (
  store: Store,
  organizationID: string,
  accountID: string,
) {
  const workspaces = store
    .select({ id: WorkspaceTable.id })
    .from(WorkspaceTable)
    .where(eq(WorkspaceTable.organization_id, organizationID))
  yield* query(
    store
      .delete(KeyTable)
      .where(and(eq(KeyTable.account_id, accountID), sql`${KeyTable.workspace_id} in (${workspaces})`))
      .run(),
  )
})

export interface Options {
  readonly setupToken: string
  readonly sso?: boolean
}

const make = Effect.fn("Console.make")(function* (options: Options) {
  const db = (yield* Database.Service).db
  const transaction = <A, R>(body: (store: Store) => Effect.Effect<A, Console.Failure, R>) =>
    db.transaction(body).pipe(Effect.catchTag("SqlError", Effect.die))
  const newSession = Effect.fn("Console.newSession")(function* () {
    const token = ConsoleCrypto.token("rdcs_")
    return { token, hash: yield* Effect.promise(() => ConsoleCrypto.digest(token)) }
  })
  return {
    status: () =>
      query(
        db
          .select({ count: sql<number>`count(*)` })
          .from(AccountTable)
          .get(),
      ).pipe(
        Effect.flatMap((row) =>
          query(db.select().from(AuthProviderTable).where(eq(AuthProviderTable.enabled, true)).limit(1).get()).pipe(
            Effect.map(
              (provider): Console.Status => ({
                needsSetup: !row?.count,
                billing: false,
                sso: !!provider || (options.sso ?? false),
                gateway: false,
              }),
            ),
          ),
        ),
      ),
    identities: (token: string) =>
      authenticate(db, token).pipe(
        Effect.flatMap((actor) =>
          query(
            db
              .select({
                issuer: IdentityTable.issuer,
                subject: IdentityTable.subject,
                createdAt: IdentityTable.created_at,
              })
              .from(IdentityTable)
              .where(eq(IdentityTable.account_id, actor.account.id))
              .all(),
          ),
        ),
      ),
    federationStart: Effect.fn("Console.federationStart")(function* (
      input: Omit<typeof FederationAttemptTable.$inferInsert, "invite_hash" | "session_hash">,
      inviteToken?: string,
      linkToken?: string,
    ) {
      const inviteHash = inviteToken ? yield* Effect.promise(() => ConsoleCrypto.digest(inviteToken)) : null
      return yield* transaction((store) =>
        Effect.gen(function* () {
          const actor = linkToken ? yield* authenticate(store, linkToken) : undefined
          if (actor && actor.expiresAt - 7 * 24 * 60 * 60 * 1000 < Date.now() - 300000)
            return yield* failure("unauthorized", "Sign in again before linking an identity (within five minutes)")
          yield* query(
            store.delete(FederationAttemptTable).where(lte(FederationAttemptTable.expires_at, Date.now())).run(),
          )
          yield* query(
            store
              .insert(FederationAttemptTable)
              .values({ ...input, invite_hash: inviteHash, session_hash: actor?.hash ?? null })
              .run(),
          )
        }),
      )
    }),
    federationConsume: Effect.fn("Console.federationConsume")(function* (state: string, browser: string) {
      const stateHash = yield* Effect.promise(() => ConsoleCrypto.digest(state))
      const browserHash = yield* Effect.promise(() => ConsoleCrypto.digest(browser))
      return yield* transaction((store) =>
        Effect.gen(function* () {
          const attempt = yield* query(
            store
              .select()
              .from(FederationAttemptTable)
              .where(
                and(
                  eq(FederationAttemptTable.state_hash, stateHash),
                  eq(FederationAttemptTable.browser_hash, browserHash),
                ),
              )
              .get(),
          )
          if (!attempt || attempt.expires_at <= Date.now())
            return yield* failure("unauthorized", "Invalid or expired sign-in attempt")
          yield* query(
            store.delete(FederationAttemptTable).where(eq(FederationAttemptTable.state_hash, stateHash)).run(),
          )
          return attempt
        }),
      )
    }),
    federationComplete: Effect.fn("Console.federationComplete")(function* (
      attempt: typeof FederationAttemptTable.$inferSelect,
      profile: {
        readonly subject: string
        readonly email?: string
        readonly name?: string
        readonly verified: boolean
      },
    ) {
      const session = yield* newSession()
      return yield* transaction((store) =>
        Effect.gen(function* () {
          const identity = yield* query(
            store
              .select()
              .from(IdentityTable)
              .where(and(eq(IdentityTable.issuer, attempt.issuer), eq(IdentityTable.subject, profile.subject)))
              .get(),
          )
          const link = attempt.session_hash
            ? yield* query(
                store.select().from(SessionTable).where(eq(SessionTable.token_hash, attempt.session_hash)).get(),
              )
            : undefined
          if (attempt.session_hash && (!link || link.expires_at <= Date.now()))
            return yield* failure("unauthorized", "Sign in again before linking an identity")
          if (identity && link && identity.account_id !== link.account_id)
            return yield* failure("conflict", "This identity is already linked to another account")
          let account =
            identity || link
              ? yield* query(
                  store
                    .select()
                    .from(AccountTable)
                    .where(eq(AccountTable.id, identity?.account_id ?? link!.account_id))
                    .get(),
                )
              : undefined
          if (!account) {
            if (!attempt.invite_hash || !profile.email || !profile.verified)
              return yield* failure(
                "forbidden",
                "Link this identity from your account settings, or sign in with an invitation and a verified email",
              )
            const invite = yield* query(
              store.select().from(InviteTable).where(eq(InviteTable.token_hash, attempt.invite_hash)).get(),
            )
            if (!invite || invite.expires_at <= Date.now() || invite.email !== email(profile.email))
              return yield* failure("unauthorized", "Invalid or expired invitation")
            if (yield* query(store.select().from(AccountTable).where(eq(AccountTable.email, invite.email)).get()))
              return yield* failure(
                "conflict",
                "This account already exists; sign in and explicitly link your identity",
              )
            account = {
              id: id("rdcacc"),
              email: invite.email,
              name: profile.name?.trim().slice(0, 100) || invite.email.slice(0, 100),
              password_hash: "",
              created_at: Date.now(),
            }
            yield* query(store.insert(AccountTable).values(account).run())
            yield* query(
              store
                .insert(MemberTable)
                .values({ organization_id: invite.organization_id, account_id: account.id, role: invite.role })
                .run(),
            )
            yield* query(store.delete(InviteTable).where(eq(InviteTable.id, invite.id)).run())
            yield* audit(store, invite.organization_id, account.id, "invite.accepted", invite.id)
          }
          if (!identity) {
            yield* query(
              store
                .insert(IdentityTable)
                .values({
                  issuer: attempt.issuer,
                  subject: profile.subject,
                  account_id: account.id,
                  created_at: Date.now(),
                })
                .run(),
            )
            const memberships = yield* query(
              store.select().from(MemberTable).where(eq(MemberTable.account_id, account.id)).all(),
            )
            for (const member of memberships)
              yield* audit(store, member.organization_id, account.id, "identity.linked", attempt.issuer)
          }
          if (attempt.scope_kind === "organization") {
            const membership = yield* query(
              store
                .select()
                .from(MemberTable)
                .where(and(eq(MemberTable.organization_id, attempt.scope_id!), eq(MemberTable.account_id, account.id)))
                .get(),
            )
            if (!membership)
              return yield* failure("forbidden", "This identity provider is limited to members of its organization")
          }
          if (attempt.scope_kind === "infrastructure") {
            const membership = yield* query(
              store
                .select()
                .from(OwnerMemberTable)
                .where(
                  and(eq(OwnerMemberTable.owner_id, attempt.scope_id!), eq(OwnerMemberTable.account_id, account.id)),
                )
                .get(),
            )
            if (!membership)
              return yield* failure(
                "forbidden",
                "This identity provider is limited to members of its infrastructure owner",
              )
          }
          return yield* issueSession(store, account, session.token, session.hash, 60000)
        }),
      )
    }),
    federationSession: Effect.fn("Console.federationSession")(function* (token: string) {
      return yield* transaction((store) =>
        Effect.gen(function* () {
          const actor = yield* authenticate(store, token)
          // Rotate the short-lived browser handoff; a copied handoff cannot be redeemed twice.
          const session = yield* newSession()
          yield* query(store.delete(SessionTable).where(eq(SessionTable.token_hash, actor.hash)).run())
          return yield* issueSession(store, actor.account, session.token, session.hash)
        }),
      )
    }),
    bootstrap: Effect.fn("Console.bootstrap")(function* (input: Console.Bootstrap) {
      if (!ConsoleCrypto.equal(input.setupToken, options.setupToken))
        return yield* failure("unauthorized", "Invalid setup code")
      const passwordHash = yield* Effect.promise(() => ConsoleCrypto.password(input.password))
      const session = yield* newSession()
      return yield* transaction((store) =>
        Effect.gen(function* () {
          if (yield* query(store.select().from(AccountTable).limit(1).get()))
            return yield* failure("conflict", "Console setup has already completed")
          const account = {
            id: id("rdcacc"),
            email: email(input.email),
            name: input.name.trim(),
            password_hash: passwordHash,
            created_at: Date.now(),
          }
          const organizationID = id("rdcorg")
          yield* query(store.insert(AccountTable).values(account).run())
          const ownerID = id("rdcinfra")
          yield* query(
            store.insert(OwnerTable).values({ id: ownerID, name: "Infrastructure", created_at: Date.now() }).run(),
          )
          yield* query(
            store.insert(OwnerMemberTable).values({ owner_id: ownerID, account_id: account.id, role: "admin" }).run(),
          )
          yield* query(
            store
              .insert(OrganizationTable)
              .values({ id: organizationID, name: input.organization.trim(), created_at: Date.now() })
              .run(),
          )
          yield* query(
            store
              .insert(MemberTable)
              .values({ organization_id: organizationID, account_id: account.id, role: "owner" })
              .run(),
          )
          yield* query(
            store
              .insert(WorkspaceTable)
              .values({ id: id("rdcws"), organization_id: organizationID, name: "Default", created_at: Date.now() })
              .run(),
          )
          yield* audit(store, organizationID, account.id, "organization.created", organizationID)
          return yield* issueSession(store, account, session.token, session.hash)
        }),
      )
    }),
    login: Effect.fn("Console.login")(function* (input: Console.Login) {
      const account = yield* query(
        db
          .select()
          .from(AccountTable)
          .where(eq(AccountTable.email, email(input.email)))
          .get(),
      )
      if (!account || !(yield* Effect.promise(() => ConsoleCrypto.verify(input.password, account.password_hash))))
        return yield* failure("unauthorized", "Invalid email or password")
      const session = yield* newSession()
      return yield* transaction((store) =>
        Effect.gen(function* () {
          const current = yield* query(store.select().from(AccountTable).where(eq(AccountTable.id, account.id)).get())
          if (!current || current.password_hash !== account.password_hash)
            return yield* failure("unauthorized", "Invalid email or password")
          return yield* issueSession(store, current, session.token, session.hash)
        }),
      )
    }),
    register: Effect.fn("Console.register")(function* (input: Console.Register) {
      const inviteHash = yield* Effect.promise(() => ConsoleCrypto.digest(input.inviteToken))
      const passwordHash = yield* Effect.promise(() => ConsoleCrypto.password(input.password))
      const session = yield* newSession()
      return yield* transaction((store) =>
        Effect.gen(function* () {
          const invite = yield* query(
            store.select().from(InviteTable).where(eq(InviteTable.token_hash, inviteHash)).get(),
          )
          if (!invite || invite.expires_at <= Date.now() || invite.email !== email(input.email))
            return yield* failure("unauthorized", "Invalid or expired invitation")
          if (yield* query(store.select().from(AccountTable).where(eq(AccountTable.email, invite.email)).get()))
            return yield* failure("conflict", "This account already exists; sign in to accept the invitation")
          const account = {
            id: id("rdcacc"),
            email: invite.email,
            name: input.name.trim(),
            password_hash: passwordHash,
            created_at: Date.now(),
          }
          yield* query(store.insert(AccountTable).values(account).run())
          yield* query(
            store
              .insert(MemberTable)
              .values({ organization_id: invite.organization_id, account_id: account.id, role: invite.role })
              .run(),
          )
          yield* query(store.delete(InviteTable).where(eq(InviteTable.id, invite.id)).run())
          yield* audit(store, invite.organization_id, account.id, "invite.accepted", invite.id)
          return yield* issueSession(store, account, session.token, session.hash)
        }),
      )
    }),
    me: (token: string) => authenticate(db, token).pipe(Effect.map((actor) => accountInfo(actor.account))),
    logout: (token: string) =>
      transaction((store) =>
        authenticate(store, token).pipe(
          Effect.flatMap((actor) =>
            query(store.delete(SessionTable).where(eq(SessionTable.token_hash, actor.hash)).run()),
          ),
          Effect.asVoid,
        ),
      ),
    changePassword: Effect.fn("Console.changePassword")(function* (token: string, input: Console.PasswordChange) {
      const actor = yield* authenticate(db, token)
      if (!(yield* Effect.promise(() => ConsoleCrypto.verify(input.currentPassword, actor.account.password_hash))))
        return yield* failure("unauthorized", "Invalid current password")
      const hash = yield* Effect.promise(() => ConsoleCrypto.password(input.password))
      const session = yield* newSession()
      return yield* transaction((store) =>
        Effect.gen(function* () {
          const current = yield* authenticate(store, token)
          if (current.account.password_hash !== actor.account.password_hash)
            return yield* failure("conflict", "Password changed; sign in again")
          yield* query(
            store.update(AccountTable).set({ password_hash: hash }).where(eq(AccountTable.id, actor.account.id)).run(),
          )
          yield* query(store.delete(SessionTable).where(eq(SessionTable.account_id, actor.account.id)).run())
          yield* query(store.delete(KeyTable).where(eq(KeyTable.account_id, actor.account.id)).run())
          return yield* issueSession(store, actor.account, session.token, session.hash)
        }),
      )
    }),
    deleteAccount: Effect.fn("Console.deleteAccount")(function* (token: string, currentPassword: string) {
      const actor = yield* authenticate(db, token)
      if (!(yield* Effect.promise(() => ConsoleCrypto.verify(currentPassword, actor.account.password_hash))))
        return yield* failure("unauthorized", "Invalid current password")
      return yield* transaction((store) =>
        Effect.gen(function* () {
          const current = yield* authenticate(store, token)
          if (current.account.password_hash !== actor.account.password_hash)
            return yield* failure("conflict", "Password changed; sign in again")
          const infrastructure = yield* query(
            store
              .select()
              .from(OwnerMemberTable)
              .where(and(eq(OwnerMemberTable.account_id, actor.account.id), eq(OwnerMemberTable.role, "admin")))
              .all(),
          )
          for (const member of infrastructure) {
            const count = yield* query(
              store
                .select({ count: sql<number>`count(*)` })
                .from(OwnerMemberTable)
                .where(and(eq(OwnerMemberTable.owner_id, member.owner_id), eq(OwnerMemberTable.role, "admin")))
                .get(),
            )
            if (!count || count.count <= 1)
              return yield* failure(
                "conflict",
                "Transfer infrastructure administration before deleting the last administrator",
              )
          }
          const memberships = yield* query(
            store.select().from(MemberTable).where(eq(MemberTable.account_id, actor.account.id)).all(),
          )
          for (const membership of memberships) {
            yield* preserveOwner(store, membership.organization_id, actor.account.id)
            yield* audit(store, membership.organization_id, actor.account.id, "account.deleted", actor.account.id)
          }
          yield* query(store.delete(AccountTable).where(eq(AccountTable.id, actor.account.id)).run())
        }),
      )
    }),
    organizations: (token: string) =>
      authenticate(db, token).pipe(
        Effect.flatMap((actor) =>
          query(
            db
              .select({
                id: OrganizationTable.id,
                name: OrganizationTable.name,
                role: MemberTable.role,
                createdAt: OrganizationTable.created_at,
              })
              .from(OrganizationTable)
              .innerJoin(MemberTable, eq(MemberTable.organization_id, OrganizationTable.id))
              .where(eq(MemberTable.account_id, actor.account.id))
              .all(),
          ),
        ),
      ),
    createOrganization: (token: string, name: string) =>
      transaction((store) =>
        Effect.gen(function* () {
          const actor = yield* authenticate(store, token)
          const organizationID = id("rdcorg")
          const createdAt = Date.now()
          yield* query(
            store
              .insert(OrganizationTable)
              .values({ id: organizationID, name: name.trim(), created_at: createdAt })
              .run(),
          )
          yield* query(
            store
              .insert(MemberTable)
              .values({ organization_id: organizationID, account_id: actor.account.id, role: "owner" })
              .run(),
          )
          yield* audit(store, organizationID, actor.account.id, "organization.created", organizationID)
          return { id: organizationID, name: name.trim(), role: "owner" as const, createdAt }
        }),
      ),
    workspaces: (token: string, organizationID: string) =>
      access(db, token, organizationID).pipe(
        Effect.andThen(
          query(db.select().from(WorkspaceTable).where(eq(WorkspaceTable.organization_id, organizationID)).all()),
        ),
        Effect.map((rows) => rows.map(workspaceInfo)),
      ),
    createWorkspace: (token: string, organizationID: string, name: string) =>
      transaction((store) =>
        Effect.gen(function* () {
          const actor = yield* access(store, token, organizationID, ["owner", "admin"])
          const row = { id: id("rdcws"), organization_id: organizationID, name: name.trim(), created_at: Date.now() }
          yield* query(store.insert(WorkspaceTable).values(row).run())
          yield* audit(store, organizationID, actor.account.id, "workspace.created", row.id)
          return workspaceInfo(row)
        }),
      ),
    members: (token: string, organizationID: string) =>
      access(db, token, organizationID).pipe(
        Effect.andThen(
          query(
            db
              .select({
                accountID: AccountTable.id,
                email: AccountTable.email,
                name: AccountTable.name,
                role: MemberTable.role,
              })
              .from(MemberTable)
              .innerJoin(AccountTable, eq(AccountTable.id, MemberTable.account_id))
              .where(eq(MemberTable.organization_id, organizationID))
              .all(),
          ),
        ),
      ),
    setRole: (token: string, organizationID: string, accountID: string, role: Console.Role) =>
      transaction((store) =>
        Effect.gen(function* () {
          const actor = yield* access(store, token, organizationID, ["owner"])
          if (role !== "owner") yield* preserveOwner(store, organizationID, accountID)
          if (
            !(yield* query(
              store
                .select()
                .from(MemberTable)
                .where(and(eq(MemberTable.organization_id, organizationID), eq(MemberTable.account_id, accountID)))
                .get(),
            ))
          )
            return yield* failure("not_found", "Member not found")
          yield* query(
            store
              .update(MemberTable)
              .set({ role })
              .where(and(eq(MemberTable.organization_id, organizationID), eq(MemberTable.account_id, accountID)))
              .run(),
          )
          yield* audit(store, organizationID, actor.account.id, `member.role.${role}`, accountID)
        }),
      ),
    removeMember: (token: string, organizationID: string, accountID: string) =>
      transaction((store) =>
        Effect.gen(function* () {
          const actor = yield* access(store, token, organizationID)
          if (actor.account.id !== accountID && actor.role === "member")
            return yield* failure("forbidden", "Only administrators can remove other members")
          const member = yield* preserveOwner(store, organizationID, accountID)
          if (member.role === "owner" && actor.role !== "owner")
            return yield* failure("forbidden", "Only owners can remove an owner")
          yield* revokeMemberKeys(store, organizationID, accountID)
          yield* query(
            store
              .delete(MemberTable)
              .where(and(eq(MemberTable.organization_id, organizationID), eq(MemberTable.account_id, accountID)))
              .run(),
          )
          yield* audit(store, organizationID, actor.account.id, "member.removed", accountID)
        }),
      ),
    invites: (token: string, organizationID: string) =>
      access(db, token, organizationID, ["owner", "admin"]).pipe(
        Effect.andThen(
          query(db.select().from(InviteTable).where(eq(InviteTable.organization_id, organizationID)).all()),
        ),
        Effect.map((rows) => rows.filter((row) => row.expires_at > Date.now()).map(inviteInfo)),
      ),
    createInvite: Effect.fn("Console.createInvite")(function* (
      token: string,
      organizationID: string,
      input: Console.InviteCreate,
    ) {
      const inviteToken = ConsoleCrypto.token("rdci_")
      const hash = yield* Effect.promise(() => ConsoleCrypto.digest(inviteToken))
      return yield* transaction((store) =>
        Effect.gen(function* () {
          const actor = yield* access(store, token, organizationID, ["owner", "admin"])
          const existing = yield* query(
            store
              .select()
              .from(AccountTable)
              .where(eq(AccountTable.email, email(input.email)))
              .get(),
          )
          if (
            existing &&
            (yield* query(
              store
                .select()
                .from(MemberTable)
                .where(and(eq(MemberTable.organization_id, organizationID), eq(MemberTable.account_id, existing.id)))
                .get(),
            ))
          )
            return yield* failure("conflict", "This account already belongs to the organization")
          yield* query(
            store
              .delete(InviteTable)
              .where(and(eq(InviteTable.organization_id, organizationID), eq(InviteTable.email, email(input.email))))
              .run(),
          )
          const row = {
            id: id("rdcinv"),
            organization_id: organizationID,
            email: email(input.email),
            role: input.role,
            token_hash: hash,
            expires_at: Date.now() + 48 * 60 * 60 * 1000,
          }
          yield* query(store.insert(InviteTable).values(row).run())
          yield* audit(store, organizationID, actor.account.id, "invite.created", row.id)
          return { invite: inviteInfo(row), token: inviteToken }
        }),
      )
    }),
    revokeInvite: (token: string, organizationID: string, inviteID: string) =>
      transaction((store) =>
        Effect.gen(function* () {
          const actor = yield* access(store, token, organizationID, ["owner", "admin"])
          const row = yield* query(
            store
              .select()
              .from(InviteTable)
              .where(and(eq(InviteTable.id, inviteID), eq(InviteTable.organization_id, organizationID)))
              .get(),
          )
          if (!row) return yield* failure("not_found", "Invitation not found")
          yield* query(store.delete(InviteTable).where(eq(InviteTable.id, row.id)).run())
          yield* audit(store, organizationID, actor.account.id, "invite.revoked", row.id)
        }),
      ),
    acceptInvite: Effect.fn("Console.acceptInvite")(function* (token: string, inviteToken: string) {
      const hash = yield* Effect.promise(() => ConsoleCrypto.digest(inviteToken))
      return yield* transaction((store) =>
        Effect.gen(function* () {
          const actor = yield* authenticate(store, token)
          const invite = yield* query(store.select().from(InviteTable).where(eq(InviteTable.token_hash, hash)).get())
          if (!invite || invite.expires_at <= Date.now() || invite.email !== actor.account.email)
            return yield* failure("unauthorized", "Invalid or expired invitation")
          yield* query(
            store
              .insert(MemberTable)
              .values({ organization_id: invite.organization_id, account_id: actor.account.id, role: invite.role })
              .onConflictDoNothing()
              .run(),
          )
          yield* query(store.delete(InviteTable).where(eq(InviteTable.id, invite.id)).run())
          yield* audit(store, invite.organization_id, actor.account.id, "invite.accepted", invite.id)
        }),
      )
    }),
    keys: (token: string, workspaceID: string) =>
      workspaceAccess(db, token, workspaceID).pipe(
        Effect.flatMap((actor) =>
          query(
            db
              .select()
              .from(KeyTable)
              .where(
                actor.role === "member"
                  ? and(eq(KeyTable.workspace_id, workspaceID), eq(KeyTable.account_id, actor.account.id))
                  : eq(KeyTable.workspace_id, workspaceID),
              )
              .all(),
          ),
        ),
        Effect.map((rows) => rows.map(keyInfo)),
      ),
    createKey: Effect.fn("Console.createKey")(function* (token: string, workspaceID: string, input: Console.KeyCreate) {
      if (input.expiresAt !== undefined && input.expiresAt <= Date.now())
        return yield* failure("invalid", "Key expiration must be in the future")
      const keyToken = ConsoleCrypto.token("rdck_")
      const hash = yield* Effect.promise(() => ConsoleCrypto.digest(keyToken))
      return yield* transaction((store) =>
        Effect.gen(function* () {
          const actor = yield* workspaceAccess(store, token, workspaceID)
          const row = {
            id: id("rdckey"),
            workspace_id: workspaceID,
            account_id: actor.account.id,
            name: input.name.trim(),
            prefix: keyToken.slice(0, 13),
            token_hash: hash,
            created_at: Date.now(),
            expires_at: input.expiresAt ?? null,
          }
          yield* query(store.insert(KeyTable).values(row).run())
          yield* audit(store, actor.workspace.organization_id, actor.account.id, "key.created", row.id)
          return { key: keyInfo(row), token: keyToken }
        }),
      )
    }),
    revokeKey: (token: string, workspaceID: string, keyID: string) =>
      transaction((store) =>
        Effect.gen(function* () {
          const actor = yield* workspaceAccess(store, token, workspaceID)
          const key = yield* query(
            store
              .select()
              .from(KeyTable)
              .where(and(eq(KeyTable.id, keyID), eq(KeyTable.workspace_id, workspaceID)))
              .get(),
          )
          if (!key) return yield* failure("not_found", "Key not found")
          if (actor.role === "member" && key.account_id !== actor.account.id)
            return yield* failure("forbidden", "You can only revoke your own keys")
          yield* query(store.delete(KeyTable).where(eq(KeyTable.id, key.id)).run())
          yield* audit(store, actor.workspace.organization_id, actor.account.id, "key.revoked", key.id)
        }),
      ),
    authenticateKey: Effect.fn("Console.authenticateKey")(function* (token: string) {
      const hash = yield* Effect.promise(() => ConsoleCrypto.digest(token))
      const row = yield* query(
        db
          .select({ key: KeyTable, organizationID: WorkspaceTable.organization_id })
          .from(KeyTable)
          .innerJoin(WorkspaceTable, eq(WorkspaceTable.id, KeyTable.workspace_id))
          .innerJoin(
            MemberTable,
            and(
              eq(MemberTable.organization_id, WorkspaceTable.organization_id),
              eq(MemberTable.account_id, KeyTable.account_id),
            ),
          )
          .where(eq(KeyTable.token_hash, hash))
          .get(),
      )
      if (!row || (row.key.expires_at !== null && row.key.expires_at <= Date.now()))
        return yield* failure("unauthorized", "Invalid or expired API key")
      return {
        organizationID: row.organizationID,
        workspaceID: row.key.workspace_id,
        accountID: row.key.account_id,
        keyID: row.key.id,
      }
    }),
    audit: (token: string, organizationID: string) =>
      access(db, token, organizationID, ["owner", "admin"]).pipe(
        Effect.andThen(
          query(
            db
              .select({
                id: AuditTable.id,
                actorID: AuditTable.actor_id,
                action: AuditTable.action,
                resourceID: AuditTable.resource_id,
                createdAt: AuditTable.created_at,
              })
              .from(AuditTable)
              .where(eq(AuditTable.organization_id, organizationID))
              .orderBy(desc(AuditTable.created_at), desc(AuditTable.id))
              .limit(200)
              .all(),
          ),
        ),
      ),
  }
})

export type Interface = Effect.Success<ReturnType<typeof make>>
export class Service extends Context.Service<Service, Interface>()("@redcode/Console") {}
export const layer = (options: Options) => Layer.effect(Service, make(options))
export const configured = (options: Options) =>
  makeGlobalNode({ service: Service, layer: layer(options), deps: [Database.node] })
