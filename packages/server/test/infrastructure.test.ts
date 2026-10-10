import { afterEach, expect, test } from "bun:test"
import { Effect } from "effect"
import { ConsoleHost } from "../src/console/host"
import { ServerProcess } from "../src/process"
import { InfrastructureAccess } from "../src/infrastructure-access"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { HttpServer } from "effect/unstable/http"
import { Database } from "bun:sqlite"
import { join } from "node:path"

const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
const password = "Test123!"
const setupToken = "local-setup-code"
async function fixture(database = ":memory:") {
  const directory = await tmpdir()
  cleanup.push(() => directory[Symbol.asyncDispose]())
  const host = await Effect.runPromise(
    ConsoleHost.create({
      setupToken,
      database: { path: database },
      directories: Object.fromEntries(
        ["home", "data", "cache", "config", "state", "tmp", "bin", "log", "repos"].map((key) => [key, directory.path]),
      ),
    }),
  )
  cleanup.push(() => host.close())
  const api = (path: string, token?: string, method = "GET", body?: unknown) =>
    host.fetch(
      new Request(`http://localhost/api/console${path}`, {
        method,
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    )
  const json = async (path: string, token?: string, method = "GET", body?: unknown) => {
    const response = await api(path, token, method, body)
    expect(response.status).toBe(200)
    const bodyText = await response.text()
    return bodyText ? JSON.parse(bodyText) : undefined
  }
  const owner = await json("/bootstrap", undefined, "POST", {
    setupToken,
    email: "owner@example.test",
    password,
    name: "Owner",
    organization: "First",
  })
  const org = (await json("/orgs", owner.token))[0]
  const workspace = (await json(`/orgs/${org.id}/workspaces`, owner.token))[0]
  const infrastructure = (await json("/infrastructure", owner.token)).owners[0]
  const invite = async (email: string, role = "member") => {
    const invitation = await json(`/orgs/${org.id}/invites`, owner.token, "POST", { email, role })
    return json("/register", undefined, "POST", { inviteToken: invitation.token, email, password, name: email })
  }
  const resource = await json(`/infrastructure/${infrastructure.id}/resources`, owner.token, "POST", {
    name: "Coordinator",
  })
  return { directory, host, api, json, owner, org, workspace, infrastructure, resource, invite }
}

test("infrastructure ownership is independent of organization roles, with explicit grants and revocation", async () => {
  const f = await fixture()
  const orgAdmin = await f.invite("admin@example.test", "admin")
  const orgUser = await f.invite("user@example.test")
  const operator = await f.invite("operator@example.test")
  const base = `/infrastructure/${f.infrastructure.id}`
  expect((await f.json("/infrastructure", orgAdmin.token)).owners).toEqual([])
  expect((await f.api(base + "/resources", orgAdmin.token, "POST", { name: "Forbidden" })).status).toBe(403)
  expect(
    (await f.api(base + "/members", orgAdmin.token, "PUT", { email: orgAdmin.account.email, role: "admin" })).status,
  ).toBe(403)
  // Even becoming an organization owner cannot elevate infrastructure privileges.
  await f.json(`/orgs/${f.org.id}/members/${orgAdmin.account.id}`, f.owner.token, "PUT", { role: "owner" })
  expect((await f.api(base + "/resources", orgAdmin.token, "POST", { name: "Still forbidden" })).status).toBe(403)
  await f.json(base + "/members", f.owner.token, "PUT", { email: operator.account.email, role: "user" })
  expect((await f.json(`/resources/${f.resource.id}/access`, operator.token)).ownerRole).toBe("user")
  expect((await f.api(base + "/resources", operator.token, "POST", { name: "Forbidden" })).status).toBe(403)
  expect((await f.api(`/resources/${f.resource.id}/access?workspaceID=${f.workspace.id}`, orgUser.token)).status).toBe(
    403,
  )
  const grant = await f.json(`/resources/${f.resource.id}/grants`, f.owner.token, "POST", {
    workspaceID: f.workspace.id,
    directory: "/projects/first/",
  })
  const access = await f.json(`/resources/${f.resource.id}/access?workspaceID=${f.workspace.id}`, orgUser.token)
  expect(access.directories).toEqual(["/projects/first"])
  expect(access.organizationRole).toBe("member")
  expect(access.ownerRole).toBeUndefined()
  expect(
    (
      await f.api(`/resources/${f.resource.id}/grants`, orgAdmin.token, "POST", {
        workspaceID: f.workspace.id,
        directory: "/other",
      })
    ).status,
  ).toBe(403)
  expect(
    (
      await f.api(`/resources/${f.resource.id}/grants`, f.owner.token, "POST", {
        workspaceID: f.workspace.id,
        directory: "/projects/first",
      })
    ).status,
  ).toBe(409)
  expect(
    (
      await f.api(`/resources/${f.resource.id}/grants`, f.owner.token, "POST", {
        workspaceID: f.workspace.id,
        directory: "/projects/../other",
      })
    ).status,
  ).toBe(400)
  const other = await f.json("/orgs", orgAdmin.token, "POST", { name: "Other organization" })
  const second = await f.json(`/orgs/${other.id}/workspaces`, orgAdmin.token, "POST", { name: "Second" })
  expect((await f.api(`/resources/${f.resource.id}/access?workspaceID=${second.id}`, orgAdmin.token)).status).toBe(403)
  await f.json(`/resources/${f.resource.id}/grants/${grant.id}`, f.owner.token, "DELETE")
  expect((await f.api(`/resources/${f.resource.id}/access?workspaceID=${f.workspace.id}`, orgUser.token)).status).toBe(
    403,
  )
  expect(
    (await f.api(base + "/members", f.owner.token, "PUT", { email: f.owner.account.email, role: "user" })).status,
  ).toBe(409)
  expect((await f.api(base + `/members/${f.owner.account.id}`, f.owner.token, "DELETE")).status).toBe(409)
  expect((await f.api("/account", f.owner.token, "DELETE", { currentPassword: password })).status).toBe(409)
  await f.json(base + "/members", f.owner.token, "PUT", { email: operator.account.email, role: "admin" })
  await f.json(base + "/members", operator.token, "PUT", { email: f.owner.account.email, role: "user" })
  expect((await f.api(base + "/resources", f.owner.token, "POST", { name: "No longer admin" })).status).toBe(403)
  expect((await f.api("/infrastructure", orgAdmin.token, "POST", { setupToken, name: "Take over" })).status).toBe(409)
})

test("infrastructure config rejects insecure external origins and embedded credentials", () => {
  for (const consoleURL of [
    "http://identity.example.test",
    "https://user:secret@example.test",
    "https://example.test/path",
    "https://example.test/?token=x",
  ])
    expect(() => InfrastructureAccess.validate({ consoleURL, resourceID: "resource" })).toThrow()
  expect(
    InfrastructureAccess.validate({ consoleURL: "http://127.0.0.1:1234", resourceID: "resource" }).resourceID,
  ).toBe("resource")
})

test("existing installations preserve organization membership and require an explicit local ownership claim", async () => {
  const directory = await tmpdir()
  cleanup.push(() => directory[Symbol.asyncDispose]())
  const database = join(directory.path, "console.db")
  const f = await fixture(database)
  await f.host.close()
  const old = new Database(database)
  old.run("PRAGMA foreign_keys = OFF")
  for (const table of [
    "console_infrastructure_grant",
    "console_infrastructure_audit",
    "console_infrastructure_resource",
    "console_infrastructure_member",
    "console_infrastructure_owner",
  ])
    old.run(`DROP TABLE ${table}`)
  old.run(
    "DELETE FROM migration WHERE id IN ('20261010172141_console_infrastructure', '20261010173240_infrastructure_resource_origins')",
  )
  old.close()
  const upgraded = await Effect.runPromise(ConsoleHost.create({ setupToken, database: { path: database } }))
  cleanup.push(() => upgraded.close())
  const api = (path: string, method = "GET", body?: unknown) =>
    upgraded.fetch(
      new Request("http://localhost/api/console" + path, {
        method,
        headers: { authorization: `Bearer ${f.owner.token}`, "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    )
  expect((await (await api("/orgs")).json())[0].role).toBe("owner")
  expect((await (await api("/infrastructure")).json()).owners).toEqual([])
  expect((await api("/infrastructure", "POST", { setupToken: "wrong", name: "Machines" })).status).toBe(401)
  const claims = await Promise.all([
    api("/infrastructure", "POST", { setupToken, name: "Machines" }),
    api("/infrastructure", "POST", { setupToken, name: "Machines" }),
  ])
  expect(claims.map((response) => response.status).sort()).toEqual([200, 409])
  expect((await (await api("/infrastructure")).json()).owners[0].role).toBe("admin")
})

test.skipIf(!process.env.REDCODE_TEST_BROWSER)(
  "production Console browser separates scope navigation, infrastructure roles, workspace tasks and compact drawers",
  async () => {
    const f = await fixture()
    await f.invite("operator@example.test")
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: f.host.fetch })
    cleanup.push(() => server.stop(true))
    const probe = Bun.spawn(
      [process.env.REDCODE_TEST_NODE ?? "node", join(import.meta.dir, "fixture/infrastructure-browser.mjs")],
      {
        env: { ...process.env, REDCODE_TEST_CONSOLE_URL: server.url.origin, REDCODE_TEST_WORKSPACE: f.workspace.id },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    cleanup.push(async () => {
      probe.kill()
      await probe.exited
    })
    const stderr = await new Response(probe.stderr).text()
    expect({ code: await probe.exited, stderr }).toEqual({ code: 0, stderr: "" })
  },
  30_000,
)

it.live(
  "real coordinator enforces owner/admin roles and prevents delegated access to broad host APIs",
  () =>
    Effect.gen(function* () {
      const f = yield* Effect.promise(() => fixture())
      const user = yield* Effect.promise(() => f.invite("user@example.test"))
      const operator = yield* Effect.promise(() => f.invite("operator@example.test"))
      const otherUser = yield* Effect.promise(() => f.invite("other-user@example.test"))
      const orgAdmin = yield* Effect.promise(() => f.invite("admin@example.test", "admin"))
      yield* Effect.promise(() =>
        f.json(`/infrastructure/${f.infrastructure.id}/members`, f.owner.token, "PUT", {
          email: operator.account.email,
          role: "user",
        }),
      )
      const console = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: f.host.fetch })
      yield* Effect.addFinalizer(() => Effect.sync(() => console.stop(true)))
      const server = yield* ServerProcess.start<never, never>({
        hostname: "127.0.0.1",
        port: 0,
        password: "local-secret",
        access: { consoleURL: console.url.origin, resourceID: f.resource.id },
        database: { path: ":memory:" },
        workers: { directory: `${f.directory.path}/workers` },
        config: { directory: f.directory.path, global: false, project: false, content: "{}" },
        models: { fetch: false },
        fs: { fff: false, filewatcher: false },
      })
      const origin = HttpServer.formatAddress(server.address)
      const call = (path: string, token: string, workspace?: string, method = "GET", body?: unknown) =>
        fetch(origin + path, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            ...(workspace ? { "x-redcode-workspace": workspace } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        })
      const grant = yield* Effect.promise(() =>
        f.json(`/resources/${f.resource.id}/grants`, f.owner.token, "POST", {
          workspaceID: f.workspace.id,
          directory: f.directory.path,
        }),
      )
      expect((yield* Effect.promise(() => call("/api/workers", user.token, f.workspace.id))).status).toBe(200)
      expect((yield* Effect.promise(() => call("/api/workers", user.token))).status).toBe(403)
      expect((yield* Effect.promise(() => call("/api/workers", "invalid-token", f.workspace.id))).status).toBe(401)
      expect((yield* Effect.promise(() => call("/api/workers", operator.token))).status).toBe(200)
      for (const token of [user.token, operator.token]) {
        const workspace = token === user.token ? f.workspace.id : undefined
        for (const path of ["/api/info", "/api/session", "/api/config", "/api/event"])
          expect((yield* Effect.promise(() => call(path, token, workspace))).status).toBe(403)
        expect((yield* Effect.promise(() => call("/api/pair", token, workspace, "POST", {}))).status).toBe(403)
        expect(
          (yield* Effect.promise(() => call("/api/workers/no-such-worker", token, workspace, "DELETE"))).status,
        ).toBe(403)
      }
      expect((yield* Effect.promise(() => call("/api/info", f.owner.token))).status).toBe(200)
      expect((yield* Effect.promise(() => call("/api/fs/list", user.token, f.workspace.id))).status).toBe(403)
      const workerResource = yield* Effect.promise(() =>
        f.json(`/infrastructure/${f.infrastructure.id}/resources`, f.owner.token, "POST", { name: "Worker" }),
      )
      const privateResource = yield* Effect.promise(() =>
        f.json(`/infrastructure/${f.infrastructure.id}/resources`, f.owner.token, "POST", { name: "Private worker" }),
      )
      const workerGrant = yield* Effect.promise(() =>
        f.json(`/resources/${workerResource.id}/grants`, f.owner.token, "POST", {
          workspaceID: f.workspace.id,
          directory: f.directory.path,
        }),
      )
      for (const worker of [
        {
          id: "allowed",
          resourceID: workerResource.id,
          directories: [f.directory.path, f.directory.path + "/private"],
        },
        { id: "private", resourceID: privateResource.id, directories: [f.directory.path + "/other"] },
      ]) {
        const response = yield* Effect.promise(() =>
          call("/api/workers", f.owner.token, undefined, "POST", {
            ...worker,
            url: origin,
            password: "local-secret",
            tags: [],
          }),
        )
        expect(response.status).toBe(200)
      }
      const allowed = yield* Effect.promise(async () => (await call("/api/workers", user.token, f.workspace.id)).json())
      expect(allowed.workers.map((item: { worker: { id: string } }) => item.worker.id)).toEqual(["allowed"])
      expect(allowed.workers[0].worker.directories).toEqual([f.directory.path])
      expect(
        (yield* Effect.promise(() =>
          call("/api/workers/batches", user.token, f.workspace.id, "POST", {
            tasks: [{ id: "forbidden", worker: "private", prompt: "Do not dispatch" }],
          }),
        )).status,
      ).toBe(400)
      const submitted = yield* Effect.promise(async () => {
        const response = await call("/api/workers/batches", user.token, f.workspace.id, "POST", {
          tasks: [{ id: "one", worker: "allowed", prompt: "Report status" }],
        })
        expect(response.status).toBe(200)
        return response.json()
      })
      expect(submitted.accountID).toBe(user.account.id)
      expect(submitted.workspaceID).toBe(f.workspace.id)
      expect(submitted.credentialID).toBeUndefined()
      expect(
        (yield* Effect.promise(async () => (await call("/api/workers", otherUser.token, f.workspace.id)).json()))
          .batches,
      ).toEqual([])
      expect(
        (yield* Effect.promise(async () =>
          (await call("/api/workers", orgAdmin.token, f.workspace.id)).json(),
        )).batches.map((item: { id: string }) => item.id),
      ).toContain(submitted.id)
      expect(
        (yield* Effect.promise(() =>
          call(`/api/workers/batches/${submitted.id}/collect`, otherUser.token, f.workspace.id, "POST", {
            task: "one",
          }),
        )).status,
      ).toBe(403)
      yield* Effect.promise(() =>
        f.json(`/resources/${workerResource.id}/grants/${workerGrant.id}`, f.owner.token, "DELETE"),
      )
      const revoked = yield* Effect.promise(async () => (await call("/api/workers", user.token, f.workspace.id)).json())
      expect(revoked.workers).toEqual([])
      expect(revoked.batches).toEqual([])
      expect(
        (yield* Effect.promise(() =>
          call(`/api/workers/batches/${submitted.id}/collect`, user.token, f.workspace.id, "POST", { task: "one" }),
        )).status,
      ).toBe(403)
      const deadline = Date.now() + 4_000
      while (Date.now() < deadline) {
        const batches = (yield* Effect.promise(async () => (await call("/api/workers", f.owner.token)).json())).batches
        if (batches[0].report?.tasks[0]?.state === "failed") {
          expect(batches[0].report.tasks[0].sessionID).toBeUndefined()
          break
        }
        yield* Effect.sleep("50 millis")
      }
      expect(
        (yield* Effect.promise(async () => (await call("/api/workers", f.owner.token)).json())).batches[0].report
          .tasks[0].state,
      ).toBe("failed")
      yield* Effect.promise(() => f.json(`/resources/${f.resource.id}/grants/${grant.id}`, f.owner.token, "DELETE"))
      expect((yield* Effect.promise(() => call("/api/workers", user.token, f.workspace.id))).status).toBe(403)
      yield* Effect.promise(() => f.json("/logout", operator.token, "POST"))
      expect((yield* Effect.promise(() => call("/api/workers", operator.token))).status).toBe(401)
    }),
  30_000,
)
