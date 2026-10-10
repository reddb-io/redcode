import { afterEach, expect, setSystemTime, test } from "bun:test"
import { Database } from "bun:sqlite"
import { Console } from "@opencode/schema/console"
import { Effect, Schema } from "effect"
import { ConsoleHost } from "../src/console/host"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { join } from "node:path"

// Exercise the minimum accepted length through bootstrap, registration and login.
const password = "Test123!"
const setupToken = "Console-test-setup-token"
const hosts: Awaited<ReturnType<typeof create>>[] = []
const directories: Awaited<ReturnType<typeof tmpdir>>[] = []

async function create(path = ":memory:") {
  const directory = await tmpdir("redcode-console-test-")
  directories.push(directory)
  const host = await Effect.runPromise(
    ConsoleHost.create({
      setupToken,
      database: { path },
      directories: Object.fromEntries(
        ["home", "data", "cache", "config", "state", "tmp", "bin", "log", "repos"].map((key) => [key, directory.path]),
      ),
    }),
  )
  hosts.push(host)
  return host
}
afterEach(async () => {
  setSystemTime()
  await Promise.all(hosts.splice(0).map((host) => host.close()))
  for (const directory of directories.splice(0)) await directory[Symbol.asyncDispose]()
})

async function request(
  host: Awaited<ReturnType<typeof create>>,
  path: string,
  method = "GET",
  body?: unknown,
  token?: string,
) {
  return host.fetch(
    new Request("http://localhost/api/console" + path, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  )
}
async function value<A>(response: Promise<Response>, schema: Schema.Codec<A>) {
  const result = await response
  expect(result.status).toBe(200)
  return Schema.decodeUnknownSync(schema)(await result.json())
}
const bootstrap = (host: Awaited<ReturnType<typeof create>>) =>
  value(
    request(host, "/bootstrap", "POST", {
      setupToken,
      email: "owner@example.test",
      password,
      name: "Owner",
      organization: "First",
    }),
    Console.Session,
  )
const organizations = (host: Awaited<ReturnType<typeof create>>, token: string) =>
  value(request(host, "/orgs", "GET", undefined, token), Schema.Array(Console.Organization))
const workspaces = (host: Awaited<ReturnType<typeof create>>, token: string, org: string) =>
  value(request(host, `/orgs/${org}/workspaces`, "GET", undefined, token), Schema.Array(Console.Workspace))
async function invite(
  host: Awaited<ReturnType<typeof create>>,
  owner: string,
  org: string,
  email: string,
  role: "admin" | "member" = "member",
) {
  const invitation = await value(
    request(host, `/orgs/${org}/invites`, "POST", { email, role }, owner),
    Console.IssuedInvite,
  )
  const session = await value(
    request(host, "/register", "POST", { inviteToken: invitation.token, email, password, name: email }),
    Console.Session,
  )
  return { invitation, session }
}

test("Console setup validates input, requires the setup code, and can only finish once", async () => {
  const host = await create()
  expect(await value(request(host, "/status"), Console.Status)).toEqual({
    needsSetup: true,
    billing: false,
    sso: false,
    gateway: false,
  })
  expect(
    (
      await request(host, "/bootstrap", "POST", {
        setupToken: "wrong",
        email: "owner@example.test",
        password,
        name: "Owner",
        organization: "First",
      })
    ).status,
  ).toBe(401)
  expect(
    (
      await request(host, "/bootstrap", "POST", {
        setupToken,
        email: "invalid",
        password,
        name: "Owner",
        organization: "First",
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await request(host, "/bootstrap", "POST", {
        setupToken,
        email: "owner@example.test",
        password: "1234567",
        name: "Owner",
        organization: "First",
      })
    ).status,
  ).toBe(400)
  const owner = await bootstrap(host)
  expect(owner.account.email).toBe("owner@example.test")
  expect(
    (
      await request(host, "/bootstrap", "POST", {
        setupToken,
        email: "other@example.test",
        password,
        name: "Other",
        organization: "Second",
      })
    ).status,
  ).toBe(409)
  expect((await request(host, "/orgs")).status).toBe(401)
  expect((await host.fetch(new Request("http://localhost/api/session"))).status).toBe(404)
  expect((await host.fetch(new Request("http://localhost/api/fs/read"))).status).toBe(404)
})

test("Console invitations are email-bound, one-use, revocable and expiring", async () => {
  const host = await create(),
    owner = await bootstrap(host),
    org = (await organizations(host, owner.token))[0].id
  const invitation = await value(
    request(host, `/orgs/${org}/invites`, "POST", { email: "member@example.test", role: "member" }, owner.token),
    Console.IssuedInvite,
  )
  const body = { inviteToken: invitation.token, email: "wrong@example.test", password, name: "Member" }
  expect((await request(host, "/register", "POST", body)).status).toBe(401)
  const member = await value(
    request(host, "/register", "POST", { ...body, email: "member@example.test" }),
    Console.Session,
  )
  expect((await request(host, "/register", "POST", { ...body, email: "member@example.test" })).status).toBe(401)
  expect((await organizations(host, member.token))[0].role).toBe("member")
  const revoked = await value(
    request(host, `/orgs/${org}/invites`, "POST", { email: "revoked@example.test", role: "member" }, owner.token),
    Console.IssuedInvite,
  )
  expect(
    (await request(host, `/orgs/${org}/invites/${revoked.invite.id}`, "DELETE", undefined, owner.token)).status,
  ).toBe(200)
  expect(
    (await request(host, "/register", "POST", { ...body, inviteToken: revoked.token, email: "revoked@example.test" }))
      .status,
  ).toBe(401)
  const expired = await value(
    request(host, `/orgs/${org}/invites`, "POST", { email: "expired@example.test", role: "member" }, owner.token),
    Console.IssuedInvite,
  )
  setSystemTime(new Date(expired.invite.expiresAt + 1))
  expect(
    (await request(host, "/register", "POST", { ...body, inviteToken: expired.token, email: "expired@example.test" }))
      .status,
  ).toBe(401)
})

test("Console tenant roles isolate workspaces, membership, invitations, keys and audit logs", async () => {
  const host = await create(),
    owner = await bootstrap(host),
    first = (await organizations(host, owner.token))[0].id
  const member = (await invite(host, owner.token, first, "member@example.test")).session
  const second = await value(request(host, "/orgs", "POST", { name: "Second" }, member.token), Console.Organization)
  const secondWorkspace = await value(
    request(host, `/orgs/${second.id}/workspaces`, "POST", { name: "Private" }, member.token),
    Console.Workspace,
  )
  expect((await request(host, `/orgs/${second.id}/members`, "GET", undefined, owner.token)).status).toBe(403)
  expect((await request(host, `/orgs/${second.id}/audit`, "GET", undefined, owner.token)).status).toBe(403)
  expect((await request(host, `/workspaces/${secondWorkspace.id}/keys`, "GET", undefined, owner.token)).status).toBe(
    403,
  )
  expect((await request(host, `/orgs/${first}/workspaces`, "POST", { name: "Forbidden" }, member.token)).status).toBe(
    403,
  )
  expect((await request(host, `/orgs/${first}/invites`, "GET", undefined, member.token)).status).toBe(403)
  expect(
    (await request(host, `/orgs/${first}/members/${owner.account.id}`, "PUT", { role: "member" }, member.token)).status,
  ).toBe(403)
  expect(
    (await request(host, `/orgs/${first}/members/${owner.account.id}`, "DELETE", undefined, member.token)).status,
  ).toBe(403)
  const admin = (await invite(host, owner.token, first, "admin@example.test", "admin")).session
  expect((await request(host, `/orgs/${first}/workspaces`, "POST", { name: "Allowed" }, admin.token)).status).toBe(200)
  expect(
    (await request(host, `/orgs/${first}/members/${admin.account.id}`, "PUT", { role: "owner" }, admin.token)).status,
  ).toBe(403)
})

test("Console keys are secret once, member-scoped and revoked immediately on member removal", async () => {
  const host = await create(),
    owner = await bootstrap(host),
    org = (await organizations(host, owner.token))[0].id,
    workspace = (await workspaces(host, owner.token, org))[0].id
  const member = (await invite(host, owner.token, org, "member@example.test")).session
  const own = await value(
    request(host, `/workspaces/${workspace}/keys`, "POST", { name: "Owner" }, owner.token),
    Console.IssuedKey,
  )
  const key = await value(
    request(host, `/workspaces/${workspace}/keys`, "POST", { name: "Member" }, member.token),
    Console.IssuedKey,
  )
  const list = await value(
    request(host, `/workspaces/${workspace}/keys`, "GET", undefined, member.token),
    Schema.Array(Console.Key),
  )
  expect(list.map((entry) => entry.id)).toEqual([key.key.id])
  expect(JSON.stringify(list)).not.toContain(key.token)
  expect(
    (await request(host, `/workspaces/${workspace}/keys/${own.key.id}`, "DELETE", undefined, member.token)).status,
  ).toBe(403)
  expect((await request(host, "/orgs", "GET", undefined, key.token)).status).toBe(401)
  expect(
    (await request(host, `/orgs/${org}/members/${member.account.id}`, "DELETE", undefined, owner.token)).status,
  ).toBe(200)
  expect(
    (
      await value(
        request(host, `/workspaces/${workspace}/keys`, "GET", undefined, owner.token),
        Schema.Array(Console.Key),
      )
    ).map((entry) => entry.id),
  ).toEqual([own.key.id])
  expect((await request(host, `/workspaces/${workspace}/keys`, "GET", undefined, member.token)).status).toBe(403)
})

test("Console protects the last owner even when owners concurrently relinquish their roles", async () => {
  const host = await create(),
    owner = await bootstrap(host),
    org = (await organizations(host, owner.token))[0].id
  expect(
    (await request(host, `/orgs/${org}/members/${owner.account.id}`, "PUT", { role: "member" }, owner.token)).status,
  ).toBe(409)
  expect((await request(host, "/account", "DELETE", { currentPassword: password }, owner.token)).status).toBe(409)
  const other = (await invite(host, owner.token, org, "other@example.test")).session
  expect(
    (await request(host, `/orgs/${org}/members/${other.account.id}`, "PUT", { role: "owner" }, owner.token)).status,
  ).toBe(200)
  const results = await Promise.all([
    request(host, `/orgs/${org}/members/${owner.account.id}`, "PUT", { role: "member" }, owner.token),
    request(host, `/orgs/${org}/members/${other.account.id}`, "PUT", { role: "member" }, other.token),
  ])
  expect(results.map((response) => response.status).sort()).toEqual([200, 409])
  const members = await value(
    request(host, `/orgs/${org}/members`, "GET", undefined, owner.token),
    Schema.Array(Console.Member),
  )
  expect(members.filter((member) => member.role === "owner")).toHaveLength(1)
})

test("Console password rotation revokes all old sessions and personal keys; logout and expiry invalidate tokens", async () => {
  const host = await create(),
    owner = await bootstrap(host),
    org = (await organizations(host, owner.token))[0].id,
    workspace = (await workspaces(host, owner.token, org))[0].id
  const second = await value(
    request(host, "/login", "POST", { email: "OWNER@example.test", password }),
    Console.Session,
  )
  await value(request(host, `/workspaces/${workspace}/keys`, "POST", { name: "Old" }, owner.token), Console.IssuedKey)
  const newPassword = "New123!?"
  expect(
    (await request(host, "/password", "PUT", { currentPassword: password, password: "1234567" }, owner.token)).status,
  ).toBe(400)
  const changed = await value(
    request(host, "/password", "PUT", { currentPassword: password, password: newPassword }, owner.token),
    Console.Session,
  )
  expect((await request(host, "/me", "GET", undefined, owner.token)).status).toBe(401)
  expect((await request(host, "/me", "GET", undefined, second.token)).status).toBe(401)
  expect(
    await value(
      request(host, `/workspaces/${workspace}/keys`, "GET", undefined, changed.token),
      Schema.Array(Console.Key),
    ),
  ).toEqual([])
  expect((await request(host, "/login", "POST", { email: owner.account.email, password })).status).toBe(401)
  const session = await value(
    request(host, "/login", "POST", { email: owner.account.email, password: newPassword }),
    Console.Session,
  )
  expect((await request(host, "/logout", "POST", undefined, session.token)).status).toBe(200)
  expect((await request(host, "/me", "GET", undefined, session.token)).status).toBe(401)
  setSystemTime(new Date(changed.expiresAt + 1))
  expect((await request(host, "/me", "GET", undefined, changed.token)).status).toBe(401)
})

test("Console persists accounts and memberships across host recreation without storing plaintext bearer secrets", async () => {
  const directory = await tmpdir("redcode-console-database-")
  directories.push(directory)
  const filename = join(directory.path, "console.db"),
    host = await create(filename),
    owner = await bootstrap(host),
    org = (await organizations(host, owner.token))[0].id,
    workspace = (await workspaces(host, owner.token, org))[0].id
  const key = await value(
    request(host, `/workspaces/${workspace}/keys`, "POST", { name: "Persistent" }, owner.token),
    Console.IssuedKey,
  )
  await host.close()
  const restored = await create(filename)
  expect((await value(request(restored, "/status"), Console.Status)).needsSetup).toBe(false)
  expect((await organizations(restored, owner.token))[0].name).toBe("First")
  const database = new Database(filename, { readonly: true })
  try {
    const account = database.query<{ password_hash: string }, []>("select password_hash from console_account").get()
    expect(account?.password_hash).toStartWith("pbkdf2-sha256:600000:")
    expect(account?.password_hash).not.toContain(password)
    const keys = database.query<{ token_hash: string }, []>("select token_hash from console_key").all()
    expect(keys[0].token_hash).toHaveLength(64)
    expect(keys[0].token_hash).not.toBe(key.token)
  } finally {
    database.close()
  }
})

test("existing accounts accept only their own current invitation and account deletion revokes their access", async () => {
  const host = await create()
  const owner = await bootstrap(host)
  const first = (await organizations(host, owner.token))[0].id
  const member = (await invite(host, owner.token, first, "member@example.test")).session
  const second = await value(request(host, "/orgs", "POST", { name: "Second" }, owner.token), Console.Organization)
  const previous = await value(
    request(host, `/orgs/${second.id}/invites`, "POST", { email: member.account.email, role: "member" }, owner.token),
    Console.IssuedInvite,
  )
  const current = await value(
    request(host, `/orgs/${second.id}/invites`, "POST", { email: member.account.email, role: "admin" }, owner.token),
    Console.IssuedInvite,
  )
  expect((await request(host, "/invites/accept", "POST", { token: previous.token }, member.token)).status).toBe(401)
  expect((await request(host, "/invites/accept", "POST", { token: current.token }, owner.token)).status).toBe(401)
  expect((await request(host, "/invites/accept", "POST", { token: current.token }, member.token)).status).toBe(200)
  expect((await organizations(host, member.token)).find((org) => org.id === second.id)?.role).toBe("admin")
  expect((await request(host, "/invites/accept", "POST", { token: current.token }, member.token)).status).toBe(401)
  expect((await request(host, "/account", "DELETE", { currentPassword: password }, member.token)).status).toBe(200)
  expect((await request(host, "/me", "GET", undefined, member.token)).status).toBe(401)
  expect((await request(host, "/login", "POST", { email: member.account.email, password })).status).toBe(401)
  const members = await value(
    request(host, `/orgs/${first}/members`, "GET", undefined, owner.token),
    Schema.Array(Console.Member),
  )
  expect(members.map((entry) => entry.accountID)).toEqual([owner.account.id])
})
