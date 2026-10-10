export * as ConsoleInfrastructure from "./infrastructure.js"

import { authenticate } from "../console.js"
import { Infrastructure } from "@opencode/schema/infrastructure"
import { Console } from "@opencode/schema/console"
import { Context, Effect, Layer } from "effect"
import { and, eq, sql } from "drizzle-orm"
import { Database } from "../database/database.js"
import { ConsoleCrypto } from "./crypto.js"
import path from "node:path"
import { AccountTable, MemberTable, WorkspaceTable } from "./sql.js"
import {
  OwnerTable,
  OwnerMemberTable,
  ResourceTable,
  GrantTable,
  InfrastructureAuditTable,
} from "./infrastructure.sql.js"

type Store = Pick<Database.Interface["db"], "select" | "insert" | "update" | "delete">
const query = <A>(effect: Effect.Effect<A, unknown>) => effect.pipe(Effect.orDie)
const failure = (code: Console.Failure["code"], message: string) => new Console.Failure({ code, message })
const id = () => crypto.randomUUID()
const audit = (store: Store, ownerID: string, actorID: string, action: string, resourceID: string) =>
  query(
    store
      .insert(InfrastructureAuditTable)
      .values({
        id: id(),
        owner_id: ownerID,
        actor_id: actorID,
        action,
        resource_id: resourceID,
        created_at: Date.now(),
      })
      .run(),
  )
const admin = Effect.fn("Infrastructure.admin")(function* (store: Store, token: string, ownerID: string) {
  const actor = yield* authenticate(store, token)
  const member = yield* query(
    store
      .select()
      .from(OwnerMemberTable)
      .where(and(eq(OwnerMemberTable.owner_id, ownerID), eq(OwnerMemberTable.account_id, actor.account.id)))
      .get(),
  )
  if (member?.role !== "admin") return yield* failure("forbidden", "Infrastructure administrator access required")
  return actor
})
export const preserveAdministrator = Effect.fn("Infrastructure.preserveAdministrator")(function* (
  store: Store,
  ownerID: string,
  accountID: string,
) {
  const member = yield* query(
    store
      .select()
      .from(OwnerMemberTable)
      .where(and(eq(OwnerMemberTable.owner_id, ownerID), eq(OwnerMemberTable.account_id, accountID)))
      .get(),
  )
  if (member?.role !== "admin") return
  const count = yield* query(
    store
      .select({ count: sql<number>`count(*)` })
      .from(OwnerMemberTable)
      .where(and(eq(OwnerMemberTable.owner_id, ownerID), eq(OwnerMemberTable.role, "admin")))
      .get(),
  )
  if (!count || count.count <= 1)
    return yield* failure("conflict", "Transfer infrastructure administration before removing the last administrator")
})

export const make = Effect.fn("Infrastructure.make")(function* (setupToken: string) {
  const database = yield* Database.Service
  const db = database.db
  const transaction = <A>(run: (store: Store) => Effect.Effect<A, Console.Failure>) =>
    db
      .transaction(run, { behavior: "immediate" })
      .pipe(Effect.catchIf((error) => !(error instanceof Console.Failure), Effect.die))
  const resource = Effect.fn(function* (store: Store, resourceID: string) {
    const row = yield* query(store.select().from(ResourceTable).where(eq(ResourceTable.id, resourceID)).get())
    if (!row) return yield* failure("not_found", "Infrastructure resource not found")
    return row
  })
  return {
    snapshot: (token: string) =>
      Effect.gen(function* () {
        const actor = yield* authenticate(db, token)
        const owners = yield* query(
          db
            .select({ id: OwnerTable.id, name: OwnerTable.name, role: OwnerMemberTable.role })
            .from(OwnerTable)
            .innerJoin(OwnerMemberTable, eq(OwnerTable.id, OwnerMemberTable.owner_id))
            .where(eq(OwnerMemberTable.account_id, actor.account.id))
            .all(),
        )
        const resources = yield* query(
          db
            .select({
              id: ResourceTable.id,
              ownerID: ResourceTable.owner_id,
              name: ResourceTable.name,
              url: ResourceTable.url,
            })
            .from(ResourceTable)
            .innerJoin(OwnerMemberTable, eq(OwnerMemberTable.owner_id, ResourceTable.owner_id))
            .where(eq(OwnerMemberTable.account_id, actor.account.id))
            .all(),
        )
        const grants = yield* query(
          db
            .select({
              id: GrantTable.id,
              resourceID: GrantTable.resource_id,
              workspaceID: GrantTable.workspace_id,
              organizationID: WorkspaceTable.organization_id,
              directory: GrantTable.directory,
            })
            .from(GrantTable)
            .innerJoin(WorkspaceTable, eq(WorkspaceTable.id, GrantTable.workspace_id))
            .innerJoin(ResourceTable, eq(ResourceTable.id, GrantTable.resource_id))
            .innerJoin(OwnerMemberTable, eq(OwnerMemberTable.owner_id, ResourceTable.owner_id))
            .where(and(eq(OwnerMemberTable.account_id, actor.account.id), eq(OwnerMemberTable.role, "admin")))
            .all(),
        )
        return {
          owners,
          resources: resources.map((row) => ({
            id: row.id,
            ownerID: row.ownerID,
            name: row.name,
            ...(row.url ? { url: row.url } : {}),
          })),
          grants,
        }
      }),
    workspaceResources: (token: string, workspaceID: string) =>
      Effect.gen(function* () {
        const actor = yield* authenticate(db, token)
        const workspace = yield* query(db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceID)).get())
        if (
          !workspace ||
          !(yield* query(
            db
              .select()
              .from(MemberTable)
              .where(
                and(
                  eq(MemberTable.organization_id, workspace.organization_id),
                  eq(MemberTable.account_id, actor.account.id),
                ),
              )
              .get(),
          ))
        )
          return yield* failure("forbidden", "Workspace access denied")
        const rows = yield* query(
          db
            .selectDistinct({
              id: ResourceTable.id,
              ownerID: ResourceTable.owner_id,
              name: ResourceTable.name,
              url: ResourceTable.url,
            })
            .from(ResourceTable)
            .innerJoin(GrantTable, eq(GrantTable.resource_id, ResourceTable.id))
            .where(eq(GrantTable.workspace_id, workspaceID))
            .all(),
        )
        return rows.map((row) => ({
          id: row.id,
          ownerID: row.ownerID,
          name: row.name,
          ...(row.url ? { url: row.url } : {}),
        }))
      }),
    claim: (token: string, input: typeof Infrastructure.Claim.Type) =>
      transaction((store) =>
        Effect.gen(function* () {
          const actor = yield* authenticate(store, token)
          if (!ConsoleCrypto.equal(input.setupToken, setupToken))
            return yield* failure("unauthorized", "Invalid infrastructure setup code")
          if (yield* query(store.select().from(OwnerTable).limit(1).get()))
            return yield* failure("conflict", "Infrastructure ownership is already configured")
          const owner = { id: id(), name: input.name.trim(), role: "admin" as const }
          yield* query(
            store.insert(OwnerTable).values({ id: owner.id, name: owner.name, created_at: Date.now() }).run(),
          )
          yield* query(
            store
              .insert(OwnerMemberTable)
              .values({ owner_id: owner.id, account_id: actor.account.id, role: owner.role })
              .run(),
          )
          yield* audit(store, owner.id, actor.account.id, "owner.claimed", owner.id)
          return owner
        }),
      ),
    members: (token: string, ownerID: string) =>
      Effect.gen(function* () {
        yield* admin(db, token, ownerID)
        return yield* query(
          db
            .select({
              accountID: AccountTable.id,
              email: AccountTable.email,
              name: AccountTable.name,
              role: OwnerMemberTable.role,
            })
            .from(OwnerMemberTable)
            .innerJoin(AccountTable, eq(AccountTable.id, OwnerMemberTable.account_id))
            .where(eq(OwnerMemberTable.owner_id, ownerID))
            .all(),
        )
      }),
    setMember: (token: string, ownerID: string, email: string, role: Infrastructure.Role) =>
      transaction((store) =>
        Effect.gen(function* () {
          const actor = yield* admin(store, token, ownerID)
          const account = yield* query(
            store.select().from(AccountTable).where(eq(AccountTable.email, email.trim().toLowerCase())).get(),
          )
          if (!account)
            return yield* failure(
              "not_found",
              "Invite this account to the Console before granting infrastructure access",
            )
          if (role !== "admin") yield* preserveAdministrator(store, ownerID, account.id)
          yield* query(
            store
              .insert(OwnerMemberTable)
              .values({ owner_id: ownerID, account_id: account.id, role })
              .onConflictDoUpdate({ target: [OwnerMemberTable.owner_id, OwnerMemberTable.account_id], set: { role } })
              .run(),
          )
          yield* audit(store, ownerID, actor.account.id, `member.${role}`, account.id)
        }),
      ),
    removeMember: (token: string, ownerID: string, accountID: string) =>
      transaction((store) =>
        Effect.gen(function* () {
          const actor = yield* admin(store, token, ownerID)
          yield* preserveAdministrator(store, ownerID, accountID)
          yield* query(
            store
              .delete(OwnerMemberTable)
              .where(and(eq(OwnerMemberTable.owner_id, ownerID), eq(OwnerMemberTable.account_id, accountID)))
              .run(),
          )
          yield* audit(store, ownerID, actor.account.id, "member.removed", accountID)
        }),
      ),
    register: (token: string, ownerID: string, input: typeof Infrastructure.ResourceCreate.Type) =>
      transaction((store) =>
        Effect.gen(function* () {
          const actor = yield* admin(store, token, ownerID)
          const url = input.url ? URL.parse(input.url) : undefined
          if (
            input.url &&
            (!url ||
              (url.protocol !== "https:" &&
                !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) ||
              url.username ||
              url.password ||
              url.search ||
              url.hash ||
              url.pathname !== "/")
          )
            return yield* failure(
              "invalid",
              "Use an HTTPS server origin or loopback HTTP, without paths or credentials",
            )
          const row = { id: id(), ownerID, name: input.name.trim(), ...(url ? { url: url.origin } : {}) }
          yield* query(
            store.insert(ResourceTable).values({ id: row.id, owner_id: ownerID, name: row.name, url: row.url }).run(),
          )
          yield* audit(store, ownerID, actor.account.id, "resource.registered", row.id)
          return row
        }),
      ),
    grant: (token: string, resourceID: string, input: typeof Infrastructure.GrantCreate.Type) =>
      transaction((store) =>
        Effect.gen(function* () {
          const host = yield* resource(store, resourceID)
          const actor = yield* admin(store, token, host.owner_id)
          const workspace = yield* query(
            store.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, input.workspaceID)).get(),
          )
          if (!workspace) return yield* failure("not_found", "Workspace not found")
          // Paths belong to the target host; never normalize a Linux worker path using the coordinator's Windows rules.
          if (
            !/^(\/|[a-zA-Z]:[\\/])/.test(input.directory) ||
            input.directory.includes("\0") ||
            input.directory.split(/[\\/]/).includes("..")
          )
            return yield* failure("invalid", "Use an absolute checkout directory without parent traversal")
          const directory = /^[a-zA-Z]:[\\/]/.test(input.directory)
            ? path.win32
                .normalize(input.directory)
                .toLowerCase()
                .replace(/[\\/]$/, "")
            : path.posix.normalize(input.directory).replace(/\/$/, "") || "/"
          if (
            yield* query(
              store
                .select()
                .from(GrantTable)
                .where(and(eq(GrantTable.resource_id, resourceID), eq(GrantTable.directory, directory)))
                .get(),
            )
          )
            return yield* failure(
              "conflict",
              "This checkout already has a workspace grant; revoke it before reassigning",
            )
          const row = {
            id: id(),
            resourceID,
            workspaceID: workspace.id,
            organizationID: workspace.organization_id,
            directory,
          }
          yield* query(
            store
              .insert(GrantTable)
              .values({ id: row.id, resource_id: resourceID, workspace_id: workspace.id, directory: row.directory })
              .run(),
          )
          yield* audit(store, host.owner_id, actor.account.id, "grant.created", row.id)
          return row
        }),
      ),
    revoke: (token: string, resourceID: string, grantID: string) =>
      transaction((store) =>
        Effect.gen(function* () {
          const host = yield* resource(store, resourceID)
          const actor = yield* admin(store, token, host.owner_id)
          yield* query(
            store
              .delete(GrantTable)
              .where(and(eq(GrantTable.id, grantID), eq(GrantTable.resource_id, resourceID)))
              .run(),
          )
          yield* audit(store, host.owner_id, actor.account.id, "grant.revoked", grantID)
        }),
      ),
    access: (token: string, resourceID: string, workspaceID?: string) =>
      Effect.gen(function* () {
        const actor = yield* authenticate(db, token)
        const host = yield* resource(db, resourceID)
        const membership = yield* query(
          db
            .select()
            .from(OwnerMemberTable)
            .where(and(eq(OwnerMemberTable.owner_id, host.owner_id), eq(OwnerMemberTable.account_id, actor.account.id)))
            .get(),
        )
        if (!workspaceID && membership)
          return {
            accountID: actor.account.id,
            resourceID,
            ownerID: host.owner_id,
            ownerRole: membership.role,
            directories: [],
          }
        if (!workspaceID) return yield* failure("forbidden", "Select an authorized workspace")
        const workspace = yield* query(db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceID)).get())
        if (!workspace) return yield* failure("forbidden", "Workspace access denied")
        const member = yield* query(
          db
            .select()
            .from(MemberTable)
            .where(
              and(
                eq(MemberTable.organization_id, workspace.organization_id),
                eq(MemberTable.account_id, actor.account.id),
              ),
            )
            .get(),
        )
        const grants = yield* query(
          db
            .select()
            .from(GrantTable)
            .where(and(eq(GrantTable.resource_id, resourceID), eq(GrantTable.workspace_id, workspaceID)))
            .all(),
        )
        if (!member || !grants.length)
          return yield* failure("forbidden", "This workspace has no access to the resource")
        return {
          accountID: actor.account.id,
          resourceID,
          ownerID: host.owner_id,
          workspaceID,
          organizationID: workspace.organization_id,
          organizationRole: member.role,
          directories: grants.map((grant) => grant.directory),
        }
      }),
  }
})
export class Service extends Context.Service<Service, Effect.Success<ReturnType<typeof make>>>()(
  "@redcode/ConsoleInfrastructure",
) {}
export const layer = (setupToken: string) => Layer.effect(Service, make(setupToken))
