import { afterEach, expect, setSystemTime, test } from "bun:test"
import { Effect } from "effect"
import { Database } from "bun:sqlite"
import { exportJWK, generateKeyPair, SignJWT } from "jose"
import { ConsoleHost } from "../src/console/host"
import { ConsoleFederation } from "../src/console/federation"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { join } from "node:path"

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  setSystemTime()
  for (const close of cleanup.splice(0).reverse()) await close()
})
const origin = "http://localhost:35556"
const password = "Test123!"
const secret = "disposable-oidc-test-client-secret"

// A real HTTP code/token/JWKS/UserInfo exchange with signed RSA tokens; no production network overrides.
async function idp(callbackOrigin = origin) {
  const key = await generateKeyPair("RS256")
  const wrong = await generateKeyPair("RS256")
  const publicKey = { ...(await exportJWK(key.publicKey)), kid: "fixture", use: "sig", alg: "RS256" }
  const codes = new Map<string, URLSearchParams>()
  const users = new Map<string, { sub: string; email: string; email_verified: boolean; name: string }>()
  let user = { sub: "owner-subject", email: "owner@example.test", email_verified: true, name: "Owner" }
  let fault = ""
  let exchanges = 0
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const issuer = server.url.origin
      if (url.pathname === "/.well-known/openid-configuration")
        return Response.json({
          issuer,
          authorization_endpoint: issuer + "/authorize",
          token_endpoint: issuer + "/token",
          jwks_uri: issuer + "/jwks",
          userinfo_endpoint: issuer + "/userinfo",
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: ["client_secret_basic"],
          code_challenge_methods_supported: ["S256"],
        })
      if (url.pathname === "/jwks") return Response.json({ keys: [publicKey] })
      if (url.pathname === "/authorize") {
        expect(url.searchParams.get("code_challenge_method")).toBe("S256")
        expect(url.searchParams.get("redirect_uri")).toBe(callbackOrigin + "/api/console/federation/callback")
        const code = crypto.randomUUID()
        codes.set(code, url.searchParams)
        const callback = new URL(url.searchParams.get("redirect_uri")!)
        callback.search = new URLSearchParams({ code, state: url.searchParams.get("state")! }).toString()
        return Response.redirect(callback.href, 302)
      }
      if (url.pathname === "/token") {
        exchanges++
        const form = new URLSearchParams(await request.text())
        const code = form.get("code")!
        const parameters = codes.get(code)
        codes.delete(code)
        const hash = Buffer.from(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(form.get("code_verifier")!)),
        ).toString("base64url")
        if (
          !parameters ||
          parameters.get("code_challenge") !== hash ||
          form.get("redirect_uri") !== parameters.get("redirect_uri") ||
          Buffer.from(request.headers.get("authorization")?.slice(6) ?? "", "base64")
            .toString()
            .split(":")
            .map(decodeURIComponent)
            .join(":") !==
            "redcode:" + secret
        )
          return Response.json({ error: "invalid_grant" }, { status: 400 })
        const access = crypto.randomUUID()
        users.set(access, { ...user })
        const token = await new SignJWT({
          nonce: fault === "nonce" ? "incorrect-nonce" : parameters.get("nonce"),
        })
          .setProtectedHeader({ alg: "RS256", kid: "fixture" })
          .setIssuer(fault === "issuer" ? "https://wrong.example" : issuer)
          .setSubject(user.sub)
          .setAudience(fault === "audience" ? "another-client" : "redcode")
          .setIssuedAt()
          .setExpirationTime(fault === "expiry" ? Math.floor(Date.now() / 1000) - 1000 : "10m")
          .sign(fault === "signature" ? wrong.privateKey : key.privateKey)
        return Response.json({ access_token: access, token_type: "Bearer", expires_in: 600, id_token: token })
      }
      if (url.pathname === "/userinfo") {
        const profile = users.get(request.headers.get("authorization")?.slice(7) ?? "")
        return Response.json(fault === "subject" ? { ...profile, sub: "different-subject" } : profile)
      }
      return new Response("missing", { status: 404 })
    },
  })
  cleanup.push(() => server.stop(true))
  return {
    issuer: server.url.origin,
    setUser: (value: Partial<typeof user>) => {
      user = { ...user, ...value }
    },
    setFault: (value: string) => {
      fault = value
    },
    exchanges: () => exchanges,
  }
}

async function create(providers: readonly Awaited<ReturnType<typeof idp>>[], path = ":memory:", publicURL = origin) {
  const directory = await tmpdir("redcode-federation-")
  cleanup.push(() => directory[Symbol.asyncDispose]())
  const host = await Effect.runPromise(
    ConsoleHost.create({
      setupToken: "setup-code",
      database: { path },
      directories: Object.fromEntries(
        ["home", "data", "cache", "config", "state", "tmp", "bin", "log", "repos"].map((key) => [key, directory.path]),
      ),
      federation: providers.length
        ? {
            publicURL,
            providers: providers.map((provider, index) => ({
              id: "realm-" + index,
              name: "Realm " + index,
              issuer: provider.issuer,
              clientID: "redcode",
              clientSecret: secret,
            })),
          }
        : undefined,
    }),
  )
  cleanup.push(host.close)
  return host
}
type Host = Awaited<ReturnType<typeof create>>
async function api(
  host: Host,
  path: string,
  body?: unknown,
  token?: string,
  cookie?: string,
  requestOrigin = origin,
  method = body === undefined ? "GET" : "POST",
) {
  return host.fetch(
    new Request(origin + "/api/console" + path, {
      method,
      headers: {
        "content-type": "application/json",
        origin: requestOrigin,
        ...(token ? { authorization: "Bearer " + token } : {}),
        ...(cookie ? { cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  )
}
async function owner(host: Host) {
  const response = await api(host, "/bootstrap", {
    setupToken: "setup-code",
    email: "owner@example.test",
    name: "Owner",
    password,
    organization: "First",
  })
  expect(response.status).toBe(200)
  return response.json() as Promise<{ token: string; account: { id: string } }>
}
async function begin(
  host: Host,
  body: { providerID?: string; link?: boolean; inviteToken?: string } = {},
  token?: string,
) {
  const start = await api(host, "/federation/start", { providerID: "realm-0", ...body }, token)
  expect(start.status).toBe(200)
  const cookie = start.headers.get("set-cookie")!.split(";")[0]
  expect(start.headers.get("set-cookie")).toContain("HttpOnly")
  const auth = await fetch((await start.json()).url, { redirect: "manual" })
  return { cookie, callback: auth.headers.get("location")! }
}
async function callback(host: Host, attempt: Awaited<ReturnType<typeof begin>>, cookie = attempt.cookie) {
  return host.fetch(new Request(attempt.callback, { headers: { cookie } }))
}
async function redeem(host: Host, response: Response) {
  expect(response.headers.get("location")).toBe("/?federation=success")
  const cookie = response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith("redcode-console-handoff="))!
    .split(";")[0]
  const exchanged = await api(host, "/federation/session", {}, undefined, cookie)
  expect(exchanged.status).toBe(200)
  expect((await api(host, "/federation/session", {}, undefined, cookie)).status).toBe(401)
  return exchanged.json() as Promise<{ token: string; account: { id: string; localPassword: boolean } }>
}

test("OIDC provider configuration requires safe origins, explicit public clients and unique realms", () => {
  expect(() => ConsoleFederation.validate({ publicURL: "http://public.example", providers: [] })).toThrow()
  expect(() =>
    ConsoleFederation.validate({
      publicURL: origin,
      providers: [{ id: "one", name: "One", issuer: "https://id.example", clientID: "redcode" }],
    }),
  ).toThrow("Missing client secret")
  expect(
    ConsoleFederation.validate({
      publicURL: origin,
      providers: [
        { id: "one", name: "One", issuer: "https://id.example", clientID: "redcode", tokenAuthMethod: "none" },
      ],
    }).providers,
  ).toHaveLength(1)
})
test("OIDC supports explicit linking, code+PKCE login, one-use handoff and local session logout", async () => {
  const provider = await idp(),
    host = await create([provider]),
    account = await owner(host)
  expect((await (await api(host, "/status")).json()).sso).toBe(true)
  const advertised = await (await api(host, "/federation/providers")).text()
  expect(advertised).not.toContain(secret)
  expect(
    (await api(host, "/federation/start", { providerID: "realm-0" }, undefined, undefined, "https://attacker.example"))
      .status,
  ).toBe(401)
  const linked = await redeem(host, await callback(host, await begin(host, { link: true }, account.token)))
  expect(linked.account.id).toBe(account.account.id)
  const identities = await (await api(host, "/identities", undefined, linked.token)).json()
  expect(identities).toMatchObject([{ issuer: provider.issuer, subject: "owner-subject" }])
  const attempt = await begin(host)
  const signedIn = await redeem(host, await callback(host, attempt))
  expect(signedIn.account.id).toBe(account.account.id)
  expect((await callback(host, attempt)).headers.get("location")).toBe("/?federation=failed")
  expect(provider.exchanges()).toBe(2)
  expect((await api(host, "/logout", {}, signedIn.token)).status).toBe(200)
  expect((await api(host, "/me", undefined, signedIn.token)).status).toBe(401)
})
test("OIDC never joins an existing local account by matching its email", async () => {
  const provider = await idp(),
    host = await create([provider])
  await owner(host)
  expect((await callback(host, await begin(host))).headers.get("location")).toBe("/?federation=failed")
})
test("OIDC binds state to the initiating browser and rejects revoked linking sessions", async () => {
  const provider = await idp(),
    host = await create([provider]),
    account = await owner(host)
  const first = await begin(host, { link: true }, account.token)
  expect((await callback(host, first, "redcode-console-flow=wrong-browser")).headers.get("location")).toBe(
    "/?federation=failed",
  )
  expect(provider.exchanges()).toBe(0)
  await api(host, "/logout", {}, account.token)
  expect((await callback(host, first)).headers.get("location")).toBe("/?federation=failed")
})
for (const fault of ["nonce", "issuer", "audience", "expiry", "signature", "subject"])
  test("OIDC rejects invalid " + fault, async () => {
    const provider = await idp(),
      host = await create([provider]),
      account = await owner(host)
    provider.setFault(fault)
    const attempt = await begin(host, { link: true }, account.token)
    expect((await callback(host, attempt)).headers.get("location")).toBe("/?federation=failed")
    expect(await (await api(host, "/identities", undefined, account.token)).json()).toEqual([])
  })
test("invited OIDC accounts require verified matching email and preserve the invited role", async () => {
  const provider = await idp(),
    host = await create([provider]),
    account = await owner(host)
  const orgs = await (await api(host, "/orgs", undefined, account.token)).json()
  const invitation = await (
    await api(host, `/orgs/${orgs[0].id}/invites`, { email: "member@example.test", role: "member" }, account.token)
  ).json()
  provider.setUser({ sub: "member-subject", email: "member@example.test", email_verified: false })
  expect((await callback(host, await begin(host, { inviteToken: invitation.token }))).headers.get("location")).toBe(
    "/?federation=failed",
  )
  provider.setUser({ email_verified: true, email: "different@example.test" })
  expect((await callback(host, await begin(host, { inviteToken: invitation.token }))).headers.get("location")).toBe(
    "/?federation=failed",
  )
  provider.setUser({ email: "member@example.test" })
  const member = await redeem(host, await callback(host, await begin(host, { inviteToken: invitation.token })))
  expect(member.account.localPassword).toBe(false)
  expect((await api(host, "/login", { email: "member@example.test", password: "" })).status).toBe(401)
  const memberships = await (await api(host, "/orgs", undefined, member.token)).json()
  expect(memberships[0].role).toBe("member")
  expect(
    (await api(host, `/orgs/${orgs[0].id}/invites`, { email: "no@example.test", role: "admin" }, member.token)).status,
  ).toBe(403)
})
test("identical subjects in different realm issuers remain separate identities", async () => {
  const first = await idp(),
    second = await idp(),
    host = await create([first, second]),
    account = await owner(host)
  await redeem(host, await callback(host, await begin(host, { link: true }, account.token)))
  expect((await callback(host, await begin(host, { providerID: "realm-1" }))).headers.get("location")).toBe(
    "/?federation=failed",
  )
  await redeem(host, await callback(host, await begin(host, { providerID: "realm-1", link: true }, account.token)))
  expect(await (await api(host, "/identities", undefined, account.token)).json()).toHaveLength(2)
})
test("pending OIDC attempts and linked identities survive Console recreation", async () => {
  const provider = await idp(),
    directory = await tmpdir("redcode-oidc-durable-")
  cleanup.push(() => directory[Symbol.asyncDispose]())
  const path = join(directory.path, "console.db"),
    host = await create([provider], path),
    account = await owner(host)
  const attempt = await begin(host, { link: true }, account.token)
  await host.close()
  const restored = await create([provider], path)
  const session = await redeem(restored, await callback(restored, attempt))
  expect(session.account.id).toBe(account.account.id)
  await restored.close()
  const next = await create([provider], path)
  expect((await redeem(next, await callback(next, await begin(next)))).account.id).toBe(account.account.id)
})

test("Console upgrades the pre-federation schema without losing existing accounts or sessions", async () => {
  const provider = await idp(),
    directory = await tmpdir("redcode-console-upgrade-")
  cleanup.push(() => directory[Symbol.asyncDispose]())
  const path = join(directory.path, "console.db"),
    host = await create([provider], path),
    account = await owner(host)
  await host.close()
  // Removing only this additive migration reconstructs the immediately preceding schema.
  const previous = new Database(path)
  previous.exec(
    "DROP TABLE console_federation_attempt; DROP TABLE console_identity; DROP TABLE console_auth_provider; DROP TABLE console_auth_setting; DELETE FROM migration WHERE id IN ('20261010150140_console_federation', '20261010181731_console_auth_settings')",
  )
  previous.close()
  const upgraded = await create([provider], path)
  expect((await api(upgraded, "/me", undefined, account.token)).status).toBe(200)
  const login = await api(upgraded, "/login", { email: "owner@example.test", password })
  expect(login.status).toBe(200)
  expect(
    (await redeem(upgraded, await callback(upgraded, await begin(upgraded, { link: true }, account.token)))).account.id,
  ).toBe(account.account.id)
})

test("OIDC enforces fresh linking sessions, attempt expiry and handoff expiry", async () => {
  const provider = await idp(),
    host = await create([provider]),
    account = await owner(host)
  const attempt = await begin(host, { link: true }, account.token)
  setSystemTime(new Date(Date.now() + 11 * 60000))
  expect((await api(host, "/federation/start", { providerID: "realm-0", link: true }, account.token)).status).toBe(401)
  expect((await callback(host, attempt)).headers.get("location")).toBe("/?federation=failed")
  expect(provider.exchanges()).toBe(0)
  setSystemTime()
  const linked = await callback(host, await begin(host, { link: true }, account.token))
  expect(linked.headers.get("location")).toBe("/?federation=success")
  const cookie = linked.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith("redcode-console-handoff="))!
    .split(";")[0]
  setSystemTime(new Date(Date.now() + 61000))
  expect((await api(host, "/federation/session", {}, undefined, cookie)).status).toBe(401)
})

test("an identity cannot be relinked to another authenticated account", async () => {
  const provider = await idp(),
    host = await create([provider]),
    account = await owner(host)
  await redeem(host, await callback(host, await begin(host, { link: true }, account.token)))
  const orgs = await (await api(host, "/orgs", undefined, account.token)).json()
  const invitation = await (
    await api(host, `/orgs/${orgs[0].id}/invites`, { email: "other@example.test", role: "member" }, account.token)
  ).json()
  const other = await (
    await api(host, "/register", {
      inviteToken: invitation.token,
      email: "other@example.test",
      password,
      name: "Other",
    })
  ).json()
  expect((await callback(host, await begin(host, { link: true }, other.token))).headers.get("location")).toBe(
    "/?federation=failed",
  )
  expect((await redeem(host, await callback(host, await begin(host)))).account.id).toBe(account.account.id)
})

test.skipIf(!process.env.REDCODE_TEST_BROWSER)(
  "production Console browser performs DS account linking and federated login",
  async () => {
    let host: Host | undefined
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => host?.fetch(request) ?? new Response("Starting", { status: 503 }),
    })
    cleanup.push(() => server.stop(true))
    const provider = await idp(server.url.origin)
    host = await create([provider], ":memory:", server.url.origin)
    await owner(host)
    // Node owns Playwright's native browser process; Bun owns the production Console HTTP fixture.
    const probe = Bun.spawn(
      [process.env.REDCODE_TEST_NODE ?? "node", join(import.meta.dir, "fixture/console-browser.mjs")],
      {
        env: { ...process.env, REDCODE_TEST_CONSOLE_URL: server.url.origin },
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
  30000,
)

test("stored authentication settings take effect immediately, hide secrets and survive restart", async () => {
  const provider = await idp()
  const directory = await tmpdir("redcode-auth-settings-")
  cleanup.push(() => directory[Symbol.asyncDispose]())
  const path = join(directory.path, "console.db")
  const host = await create([], path)
  const account = await owner(host)
  const input = {
    name: "Configured provider",
    issuer: provider.issuer,
    clientID: "redcode",
    clientSecret: secret,
    tokenAuthMethod: "client_secret_basic",
    enabled: true,
  }
  const base = "/auth/global/installation"
  expect((await api(host, base + "/providers", input, account.token)).status).toBe(400)
  expect(
    (
      await api(
        host,
        "/auth/public-url",
        { publicURL: "http://unsafe.example" },
        account.token,
        undefined,
        undefined,
        "PUT",
      )
    ).status,
  ).toBe(400)
  expect(
    (await api(host, "/auth/public-url", { publicURL: origin }, account.token, undefined, undefined, "PUT")).status,
  ).toBe(200)
  const response = await api(host, base + "/providers", input, account.token)
  expect(response.status).toBe(200)
  const created = await response.json()
  expect(created.hasSecret).toBe(true)
  expect(created.clientSecret).toBeUndefined()
  expect((await api(host, base, undefined, account.token)).status).toBe(200)
  expect(await (await api(host, base, undefined, account.token)).text()).not.toContain(secret)
  expect(await (await api(host, "/federation/providers")).json()).toMatchObject([{ id: created.id, name: input.name }])
  expect((await api(host, base + "/providers/" + created.id + "/test", {}, account.token)).status).toBe(200)
  await redeem(host, await callback(host, await begin(host, { providerID: created.id, link: true }, account.token)))
  const { clientSecret, ...withoutSecret } = input
  expect(
    (
      await api(
        host,
        base + "/providers/" + created.id,
        { ...withoutSecret, name: "Renamed" },
        account.token,
        undefined,
        undefined,
        "PUT",
      )
    ).status,
  ).toBe(200)
  await host.close()
  const restored = await create([], path)
  expect(
    (await redeem(restored, await callback(restored, await begin(restored, { providerID: created.id })))).account.id,
  ).toBe(account.account.id)
  const pending = await begin(restored, { providerID: created.id })
  expect(
    (
      await api(
        restored,
        base + "/providers/" + created.id,
        { ...withoutSecret, enabled: false },
        account.token,
        undefined,
        undefined,
        "PUT",
      )
    ).status,
  ).toBe(200)
  expect(await (await api(restored, "/federation/providers")).json()).toEqual([])
  expect((await callback(restored, pending)).headers.get("location")).toBe("/?federation=failed")
  expect((await api(restored, "/me", undefined, account.token)).status).toBe(200)
  expect(
    (await api(restored, base + "/providers/" + created.id, undefined, account.token, undefined, undefined, "DELETE"))
      .status,
  ).toBe(200)
  expect((await (await api(restored, base, undefined, account.token)).json()).providers).toEqual([])
  await restored.close()
  const db = new Database(path, { readonly: true })
  expect(db.query("SELECT count(*) AS count FROM credential WHERE label = 'Console identity provider'").get()).toEqual({
    count: 0,
  })
  db.close()
})

test.skipIf(!process.env.REDCODE_TEST_BROWSER)(
  "production Console browser configures OIDC in onboarding and signs in without a config file",
  async () => {
    let host: Host | undefined
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => host?.fetch(request) ?? new Response("Starting", { status: 503 }),
    })
    cleanup.push(() => server.stop(true))
    const provider = await idp(server.url.origin)
    host = await create([])
    const probe = Bun.spawn(
      [process.env.REDCODE_TEST_NODE ?? "node", join(import.meta.dir, "fixture/console-browser.mjs")],
      {
        env: {
          ...process.env,
          REDCODE_TEST_CONSOLE_URL: server.url.origin,
          REDCODE_TEST_AUTH_SETTINGS: "true",
          REDCODE_TEST_ISSUER: provider.issuer,
        },
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
  45000,
)

test("organization settings cannot administer global or owner identity providers", async () => {
  const host = await create([])
  const account = await owner(host)
  const org = (await (await api(host, "/orgs", undefined, account.token)).json())[0]
  const infrastructure = (await (await api(host, "/infrastructure", undefined, account.token)).json()).owners[0]
  const invitation = await (
    await api(host, `/orgs/${org.id}/invites`, { email: "admin@example.test", role: "admin" }, account.token)
  ).json()
  const orgAdmin = await (
    await api(host, "/register", {
      inviteToken: invitation.token,
      email: "admin@example.test",
      name: "Org admin",
      password,
    })
  ).json()
  const input = {
    name: "Public client",
    issuer: "https://id.example.test/realm/",
    clientID: "redcode",
    tokenAuthMethod: "none",
    enabled: true,
  }
  expect(
    (await api(host, "/auth/public-url", { publicURL: origin }, orgAdmin.token, undefined, undefined, "PUT")).status,
  ).toBe(403)
  expect((await api(host, "/auth/global/installation", undefined, orgAdmin.token)).status).toBe(403)
  expect((await api(host, `/auth/infrastructure/${infrastructure.id}/providers`, input, orgAdmin.token)).status).toBe(
    403,
  )
  await api(host, "/auth/public-url", { publicURL: origin }, account.token, undefined, undefined, "PUT")
  const orgProvider = await api(host, `/auth/organization/${org.id}/providers`, input, orgAdmin.token)
  expect(orgProvider.status).toBe(200)
  const created = await orgProvider.json()
  expect(created.issuer).toBe(input.issuer)
  expect(created.hasSecret).toBe(false)
  const ownerProvider = await api(
    host,
    `/auth/infrastructure/${infrastructure.id}/providers`,
    { ...input, name: "Owners" },
    account.token,
  )
  expect(ownerProvider.status).toBe(200)
  const ownerIDP = await ownerProvider.json()
  const global = await api(host, "/auth/global/installation/providers", { ...input, name: "Global" }, account.token)
  expect(global.status).toBe(200)
  const globalIDP = await global.json()
  expect(await (await api(host, "/federation/providers")).json()).toHaveLength(1)
  expect(await (await api(host, `/federation/providers?organizationID=${org.id}`)).json()).toHaveLength(2)
  const applicable = await (await api(host, "/federation/providers?account=true", undefined, orgAdmin.token)).json()
  expect(applicable.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining([created.id, globalIDP.id]))
  expect(applicable.map((item: { id: string }) => item.id)).not.toContain(ownerIDP.id)
  expect(
    (await (await api(host, `/auth/organization/${org.id}`, undefined, orgAdmin.token)).json()).inherited,
  ).toMatchObject([{ id: globalIDP.id }])
  await api(
    host,
    `/infrastructure/${infrastructure.id}/members`,
    { email: "admin@example.test", role: "user" },
    account.token,
    undefined,
    undefined,
    "PUT",
  )
  expect((await api(host, `/auth/infrastructure/${infrastructure.id}`, undefined, orgAdmin.token)).status).toBe(403)
  expect(
    (
      await api(
        host,
        `/auth/organization/${org.id}/providers/${globalIDP.id}`,
        input,
        orgAdmin.token,
        undefined,
        undefined,
        "PUT",
      )
    ).status,
  ).toBe(404)
  await api(
    host,
    `/orgs/${org.id}/members/${orgAdmin.account.id}`,
    { role: "member" },
    account.token,
    undefined,
    undefined,
    "PUT",
  )
  expect((await api(host, `/auth/organization/${org.id}`, undefined, orgAdmin.token)).status).toBe(403)
})

test("scoped OIDC checks membership at callback without assigning organization or infrastructure roles", async () => {
  const provider = await idp()
  const host = await create([])
  const account = await owner(host)
  await api(host, "/auth/public-url", { publicURL: origin }, account.token, undefined, undefined, "PUT")
  const org = (await (await api(host, "/orgs", undefined, account.token)).json())[0]
  const infra = (await (await api(host, "/infrastructure", undefined, account.token)).json()).owners[0]
  const input = {
    name: "Scoped",
    issuer: provider.issuer,
    clientID: "redcode",
    clientSecret: secret,
    tokenAuthMethod: "client_secret_basic",
    enabled: true,
  }
  const organization = await (await api(host, `/auth/organization/${org.id}/providers`, input, account.token)).json()
  const infrastructure = await (
    await api(host, `/auth/infrastructure/${infra.id}/providers`, input, account.token)
  ).json()
  const invite = await (
    await api(host, `/orgs/${org.id}/invites`, { email: "user@example.test", role: "member" }, account.token)
  ).json()
  const user = await (
    await api(host, "/register", { inviteToken: invite.token, email: "user@example.test", name: "User", password })
  ).json()
  provider.setUser({ sub: "member-subject", email: "user@example.test" })
  await redeem(host, await callback(host, await begin(host, { providerID: organization.id, link: true }, user.token)))
  expect((await callback(host, await begin(host, { providerID: infrastructure.id }))).headers.get("location")).toBe(
    "/?federation=failed",
  )
  expect((await (await api(host, "/infrastructure", undefined, user.token)).json()).owners).toEqual([])
  const pending = await begin(host, { providerID: organization.id })
  expect(
    (
      await api(
        host,
        `/orgs/${org.id}/members/${user.account.id}`,
        undefined,
        account.token,
        undefined,
        undefined,
        "DELETE",
      )
    ).status,
  ).toBe(200)
  expect((await callback(host, pending)).headers.get("location")).toBe("/?federation=failed")
})
