import { afterAll, describe, expect, test } from "bun:test"
import { auth, refreshAuthorization } from "@modelcontextprotocol/client"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { McpClient } from "@opencode/core/mcp/client"
import { McpOAuth } from "@opencode/core/mcp/oauth"
import { Cause, Effect, Exit } from "effect"
import { hostEnvironmentLayer } from "./fixture/environment"

const authServer = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 404 }) })
afterAll(() => authServer.stop(true))

const integrationID = Integration.ID.make("mcp_test")
const methodID = Integration.MethodID.make("oauth")

const remote = (url: string) => new ConfigMCP.Remote({ type: "remote", url, oauth: { client_id: "client" } })

const credential = (input: { access: string; refresh: string; expires?: number; url: string; issuer?: string | null }) =>
  new Credential.Info({
    id: Credential.ID.make("cred_test"),
    integrationID,
    label: "test",
    value: {
      type: "oauth",
      methodID,
      access: input.access,
      refresh: input.refresh,
      expires: input.expires ?? Date.now() - 1000,
      metadata: {
        serverUrl: input.url,
        tokenType: "Bearer",
        ...(input.issuer === null ? {} : { issuer: input.issuer ?? new URL(input.url).origin }),
      },
    },
  })

// Connect-time providers read and write the credential store; this one lives in memory so tests can
// inspect the row the provider leaves behind.
const memoryCredentials = (initial: Credential.Info[]) => {
  const rows = new Map(initial.map((row) => [row.id, row]))
  let locked = false
  const waiters: Array<() => void> = []
  const acquire = () =>
    new Promise<void>((resolve) => {
      if (!locked) {
        locked = true
        resolve()
        return
      }
      waiters.push(resolve)
    })
  const unused = () => Effect.die("unused credential method")
  const service = Credential.Service.of({
    lock: unused,
    lease: () =>
      Effect.promise(async () => {
        await acquire()
        let released = false
        return {
          release: Effect.sync(() => {
            if (released) return
            released = true
            const next = waiters.shift()
            if (next) next()
            else locked = false
          }),
        }
      }),
    all: unused,
    create: unused,
    activate: unused,
    list: (id) => Effect.sync(() => Array.from(rows.values()).filter((row) => row.integrationID === id)),
    get: (id) => Effect.sync(() => rows.get(id)),
    update: (id, updates) =>
      Effect.sync(() => {
        const row = rows.get(id)
        if (row) rows.set(id, new Credential.Info({ ...row, ...updates }))
      }),
    remove: (id) => Effect.sync(() => void rows.delete(id)),
  })
  return { rows, service }
}

const connectProvider = (config: typeof ConfigMCP.Remote.Type, store: ReturnType<typeof memoryCredentials>) =>
  Effect.runPromise(
    McpOAuth.connectProvider({ config, integrationID }).pipe(Effect.provideService(Credential.Service, store.service)),
  )

// Serves authorization server metadata with the given capabilities and records DCR + token requests.
const authorizationServer = (metadata: Record<string, unknown>) => {
  const registrations: unknown[] = []
  const tokenRequests: URLSearchParams[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/.well-known/oauth-authorization-server")
        return Response.json({
          issuer: url.origin,
          authorization_endpoint: `${url.origin}/authorize`,
          token_endpoint: `${url.origin}/token`,
          registration_endpoint: `${url.origin}/register`,
          response_types_supported: ["code"],
          ...metadata,
        })
      if (request.method === "POST" && url.pathname === "/register") {
        registrations.push(await request.json())
        return Response.json({ client_id: "registered", redirect_uris: [] })
      }
      if (request.method === "POST" && url.pathname === "/token") {
        tokenRequests.push(new URLSearchParams(await request.text()))
        return Response.json({ access_token: "access", token_type: "Bearer" })
      }
      return new Response(null, { status: 404 })
    },
  })
  return { server, registrations, tokenRequests }
}

const start = (
  target: string | ReturnType<typeof Bun.serve>,
  oauth?: ConfigMCP.OAuth,
  store: ReturnType<typeof memoryCredentials> = memoryCredentials([]),
) =>
  Effect.gen(function* () {
    const authorization = yield* McpOAuth.authorize({
      name: "test",
      config: new ConfigMCP.Remote({
        type: "remote",
        url: typeof target === "string" ? target : target.url.href,
        ...(oauth ? { oauth } : {}),
      }),
      integrationID,
      methodID,
    })
    return { authorization, url: new URL(authorization.url) }
  }).pipe(Effect.provideService(Credential.Service, store.service))

const authorize = (redirect_uri?: string) =>
  Effect.runPromise(
    Effect.scoped(
      start(authServer, { client_id: "client", ...(redirect_uri ? { redirect_uri } : {}) }).pipe(
        Effect.map(({ url }) => url.searchParams.get("redirect_uri")),
      ),
    ),
  )

describe("MCP OAuth", () => {
  test("rejects URL userinfo and strips request fragments", () => {
    expect(() => McpOAuth.networkURL("https://user:pass@mcp.example/rpc")).toThrow("userinfo")
    expect(McpOAuth.networkURL("https://mcp.example/rpc#local-only").href).toBe("https://mcp.example/rpc")
  })

  test("rejects an authorization redirect to a host outside discovered metadata", async () => {
    const opened: URL[] = []
    const oauthProvider = McpOAuth.provider({
      config: remote("https://mcp.example/rpc"),
      store: McpOAuth.memoryStore(),
      discovery: {
        authorizationServerUrl: "https://auth.example",
        authorizationServerMetadata: {
          issuer: "https://auth.example",
          authorization_endpoint: "https://auth.example/authorize",
          token_endpoint: "https://auth.example/token",
          response_types_supported: ["code"],
        },
        resourceMetadata: { resource: "https://mcp.example/rpc" },
      },
      redirect: {
        url: "http://127.0.0.1/callback",
        state: "state",
        open: (url) => {
          opened.push(url)
        },
      },
    })

    expect(() => oauthProvider.redirectToAuthorization?.(new URL("https://evil.example/authorize"))).toThrow(
      "changed host",
    )
    await oauthProvider.redirectToAuthorization?.(new URL("https://auth.example/authorize#ignored"))
    expect(opened[0]?.href).toBe("https://auth.example/authorize")
  })

  test("completes interactive authorization through the loopback callback", async () => {
    const tokenRequests: URLSearchParams[] = []
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (request.method !== "POST" || url.pathname !== "/token") return new Response(null, { status: 404 })
        tokenRequests.push(new URLSearchParams(await request.text()))
        return Response.json({
          access_token: "access",
          token_type: "Bearer",
          refresh_token: "refresh",
          expires_in: 3600,
        })
      },
    })

    const credential = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { authorization, url: authorizationUrl } = yield* start(server, { client_id: "client" })
          const redirectValue = authorizationUrl.searchParams.get("redirect_uri")
          const state = authorizationUrl.searchParams.get("state")
          if (!redirectValue || !state) throw new Error("Missing OAuth redirect parameters")
          const redirect = new URL(redirectValue)
          // Browser probes must not settle the authorization before its actual redirect arrives.
          expect((yield* Effect.promise(() => fetch(redirect, { method: "OPTIONS" }))).status).toBe(400)
          expect((yield* Effect.promise(() => fetch(redirect))).status).toBe(400)
          redirect.searchParams.set("code", "accepted")
          redirect.searchParams.set("state", state)
          expect((yield* Effect.promise(() => fetch(redirect))).status).toBe(200)
          expect((yield* Effect.promise(() => fetch(redirect))).status).toBe(409)
          return yield* authorization.callback
        }),
      ),
    ).finally(() => server.stop(true))

    expect(credential.access).toBe("access")
    expect(credential.refresh).toBe("refresh")
    expect(tokenRequests).toHaveLength(1)
    expect(tokenRequests[0]?.get("grant_type")).toBe("authorization_code")
    expect(tokenRequests[0]?.get("code")).toBe("accepted")
    expect(tokenRequests[0]?.get("code_verifier")).not.toBeNull()
    expect(tokenRequests[0]?.get("resource")).toBe(server.url.href)
  })

  test("reports a rejected token exchange on the callback page", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        if (request.method !== "POST" || new URL(request.url).pathname !== "/token")
          return new Response(null, { status: 404 })
        return Response.json({ error: "invalid_client", error_description: "bad_client_secret" }, { status: 400 })
      },
    })

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { authorization, url: authorizationUrl } = yield* start(server, { client_id: "client" })
          const redirect = new URL(authorizationUrl.searchParams.get("redirect_uri") ?? "")
          redirect.searchParams.set("code", "accepted")
          redirect.searchParams.set("state", authorizationUrl.searchParams.get("state") ?? "")
          const response = yield* Effect.promise(() => fetch(redirect))
          const page = yield* Effect.promise(() => response.text())
          const exit = yield* Effect.exit(authorization.callback)
          return { status: response.status, page, exit }
        }),
      ),
    ).finally(() => server.stop(true))

    expect(result.status).toBe(400)
    expect(result.page).toContain("Authorization failed")
    expect(result.page).toContain("bad_client_secret")
    expect(result.exit._tag).toBe("Failure")
  })

  test("refreshes tokens loaded from a persisted credential", async () => {
    const tokenRequests: URLSearchParams[] = []
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (request.method !== "POST" || url.pathname !== "/token") return new Response(null, { status: 404 })
        tokenRequests.push(new URLSearchParams(await request.text()))
        return Response.json({ access_token: "next", token_type: "Bearer" })
      },
    })
    const store = memoryCredentials([credential({ access: "expired", refresh: "refresh", url: server.url.href })])
    const oauthProvider = await connectProvider(remote(server.url.href), store)

    const result = await auth(oauthProvider, { serverUrl: server.url.href }).finally(() => server.stop(true))

    expect(result).toBe("AUTHORIZED")
    expect(tokenRequests).toHaveLength(1)
    expect(tokenRequests[0]?.get("grant_type")).toBe("refresh_token")
    expect(tokenRequests[0]?.get("refresh_token")).toBe("refresh")
    // The refreshed tokens land on the same credential row, stamped with the issuer they were minted by.
    const stored = store.rows.get(Credential.ID.make("cred_test"))?.value
    expect(stored?.type === "oauth" && stored.access).toBe("next")
    expect(stored?.type === "oauth" && stored.metadata?.issuer).toBe(server.url.href)
  })

  test("requires a new login for a legacy credential without an issuer", async () => {
    const url = authServer.url.href
    const store = memoryCredentials([credential({ access: "legacy", refresh: "legacy-refresh", url, issuer: null })])
    const oauthProvider = await connectProvider(remote(url), store)

    expect(store.rows.size).toBe(0)
    expect(await oauthProvider.tokens()).toBeUndefined()
  })

  test("reports needs_auth for an unauthorized server without registering a client", async () => {
    let registrations = 0
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (request.method === "POST" && url.pathname === "/register") registrations++
        if (url.pathname === "/mcp") return new Response(null, { status: 401 })
        return new Response(null, { status: 404 })
      },
    })
    const config = new ConfigMCP.Remote({ type: "remote", url: `${server.url.origin}/mcp` })
    const oauthProvider = await connectProvider(config, memoryCredentials([]))

    const exit = await Effect.runPromise(
      Effect.scoped(McpClient.connect("test", config, import.meta.dir, oauthProvider)).pipe(
        Effect.provide(hostEnvironmentLayer),
        Effect.exit,
      ),
    ).finally(() => server.stop(true))

    const error = Exit.isFailure(exit) && Cause.squash(exit.cause)
    expect(error).toBeInstanceOf(McpClient.NeedsAuthError)
    expect(error instanceof McpClient.NeedsAuthError && error.message).toBe(
      `MCP server "${config.url}" requires a login before it can register a client`,
    )
    expect(registrations).toBe(0)
  })

  test("drops an invalidated credential only while it still holds the presented token", async () => {
    const url = authServer.url.href
    const rotated = memoryCredentials([credential({ access: "a", refresh: "r1", url })])
    const rotatedProvider = await connectProvider(remote(url), rotated)
    await rotatedProvider.tokens()
    // Another connection refreshed first; the row now holds a token this provider never presented.
    await Effect.runPromise(
      rotated.service.update(Credential.ID.make("cred_test"), {
        value: credential({ access: "b", refresh: "r2", url }).value,
      }),
    )
    await rotatedProvider.invalidateCredentials?.("tokens")
    expect(rotated.rows.size).toBe(1)

    const stale = memoryCredentials([credential({ access: "a", refresh: "r1", url })])
    const staleProvider = await connectProvider(remote(url), stale)
    await staleProvider.tokens()
    await staleProvider.invalidateCredentials?.("tokens")
    expect(stale.rows.size).toBe(0)
  })

  test("shares concurrent refreshes for the same token", async () => {
    let requests = 0
    const pending = Promise.withResolvers<void>()
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = new URLSearchParams(await request.text())
        if (body.get("grant_type") !== "refresh_token") return new Response(null, { status: 404 })
        requests++
        await pending.promise
        return Response.json({ access_token: "access", token_type: "Bearer", refresh_token: "next" })
      },
    })
    const fetchFn = await Effect.runPromise(McpOAuth.loggedFetch({ server: "test" }))
    const options = {
      metadata: {
        issuer: server.url.origin,
        authorization_endpoint: `${server.url.origin}/authorize`,
        token_endpoint: `${server.url.origin}/token`,
        response_types_supported: ["code"],
      },
      clientInformation: { client_id: "client" },
      refreshToken: "refresh",
      fetchFn,
    }

    const first = refreshAuthorization(new URL(server.url.origin), options)
    const second = refreshAuthorization(new URL(server.url.origin), options)
    // Both refreshes must reach the token endpoint before the shared response is released.
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(requests).toBe(1)
    pending.resolve()
    const results = await Promise.all([first, second]).finally(() => server.stop(true))
    expect(results).toEqual([
      { access_token: "access", token_type: "Bearer", refresh_token: "next" },
      { access_token: "access", token_type: "Bearer", refresh_token: "next" },
    ])
  })

  test("locks persisted credential read, refresh, comparison and write as one transaction", async () => {
    let requests = 0
    let active = 0
    let maxActive = 0
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = new URLSearchParams(await request.text())
        if (body.get("grant_type") !== "refresh_token") return new Response(null, { status: 404 })
        requests++
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 25))
        active--
        return Response.json({
          access_token: "rotated-access",
          token_type: "Bearer",
          refresh_token: "rotated-refresh",
          expires_in: 3600,
        })
      },
    })
    const store = memoryCredentials([credential({ access: "expired", refresh: "refresh", url: server.url.href })])
    const [first, second] = await Promise.all([
      connectProvider(remote(server.url.href), store),
      connectProvider(remote(server.url.href), store),
    ])

    const result = await Promise.all([
      auth(first, { serverUrl: server.url.href }),
      auth(second, { serverUrl: server.url.href }),
    ]).finally(() => server.stop(true))

    expect(result).toEqual(["AUTHORIZED", "AUTHORIZED"])
    // Some providers omit an issuer on refresh, so the SDK may conservatively refresh once per
    // connection. The credential transaction must still be serialized and leave the last row coherent.
    expect(requests).toBeGreaterThanOrEqual(1)
    expect(maxActive).toBe(1)
    const stored = store.rows.get(Credential.ID.make("cred_test"))?.value
    expect(stored?.type === "oauth" && stored.refresh).toBe("rotated-refresh")
  })

  test("preserves the persisted account when refresh fails transiently", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ error: "temporarily_unavailable" }, { status: 503 }),
    })
    const store = memoryCredentials([credential({ access: "expired", refresh: "refresh", url: server.url.href })])
    const oauthProvider = await connectProvider(remote(server.url.href), store)

    await expect(auth(oauthProvider, { serverUrl: server.url.href })).rejects.toThrow()
    server.stop(true)

    expect(store.rows.size).toBe(1)
    expect(store.rows.get(Credential.ID.make("cred_test"))?.value).toMatchObject({
      type: "oauth",
      refresh: "refresh",
    })
  })

  test("generates a loopback redirect URL when none is configured", async () => {
    expect(await authorize()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
  })

  test("preserves a configured redirect URL and fixed port", async () => {
    const reservation = Bun.serve({ port: 0, fetch: () => new Response() })
    const redirect = `http://127.0.0.1:${reservation.port}/fixed-callback`
    reservation.stop(true)

    expect(await authorize(redirect)).toBe(redirect)
  })

  test("rejects an invalid redirect URL", async () => {
    await expect(authorize("not a URL")).rejects.toThrow(TypeError)
  })

  test("rejects an authorization endpoint that is not http or https", async () => {
    const { server } = authorizationServer({ authorization_endpoint: "file:///tmp/authorize" })

    await expect(Effect.runPromise(Effect.scoped(start(server))).finally(() => server.stop(true))).rejects.toThrow(
      "must use http or https, received file:",
    )
  })

  test("sends the configured URL as the resource when the server publishes no metadata", async () => {
    const { server, tokenRequests } = authorizationServer({})
    const url = `${server.url.origin}/mcp`
    const oauthProvider = await connectProvider(
      remote(url),
      memoryCredentials([credential({ access: "expired", refresh: "refresh", url })]),
    )

    await auth(oauthProvider, { serverUrl: url }).finally(() => server.stop(true))

    expect(tokenRequests[0]?.get("resource")).toBe(url)
  })

  test("discovers resource metadata without the query the transport dialed", async () => {
    const probes: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        probes.push(new URL(request.url).pathname + new URL(request.url).search)
        return new Response(null, { status: 404 })
      },
    })
    const url = `${server.url.origin}/mcp`
    const oauthProvider = await connectProvider(remote(url), memoryCredentials([]))

    await auth(oauthProvider, { serverUrl: `${url}?codemode=false` })
      .catch(() => undefined)
      .finally(() => server.stop(true))

    expect(probes).toContain("/.well-known/oauth-protected-resource/mcp")
    expect(probes.some((probe) => probe.includes("codemode"))).toBe(false)
  })

  test("keeps the configured URL as the resource when metadata echoes the dialed query", async () => {
    const tokenRequests: URLSearchParams[] = []
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/.well-known/oauth-authorization-server")
          return Response.json({
            issuer: url.origin,
            authorization_endpoint: `${url.origin}/authorize`,
            token_endpoint: `${url.origin}/token`,
            response_types_supported: ["code"],
          })
        if (url.pathname === "/.well-known/oauth-protected-resource/mcp")
          return Response.json({ resource: `${url.origin}/mcp${url.search}`, authorization_servers: [url.origin] })
        if (request.method === "POST" && url.pathname === "/token") {
          tokenRequests.push(new URLSearchParams(await request.text()))
          return Response.json({ access_token: "next", token_type: "Bearer" })
        }
        return new Response(null, { status: 404 })
      },
    })
    const url = `${server.url.origin}/mcp`
    const oauthProvider = await connectProvider(
      remote(url),
      memoryCredentials([credential({ access: "expired", refresh: "refresh", url })]),
    )

    // The transport dials with ?codemode=false and follows the 401 challenge to metadata that echoes it.
    await auth(oauthProvider, {
      serverUrl: `${url}?codemode=false`,
      resourceMetadataUrl: new URL(`${server.url.origin}/.well-known/oauth-protected-resource/mcp?codemode=false`),
    }).finally(() => server.stop(true))

    expect(tokenRequests[0]?.get("grant_type")).toBe("refresh_token")
    expect(tokenRequests[0]?.get("resource")).toBe(url)
  })

  test("finds resource metadata through the 401 header when the well-known path is not served", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/mcp")
          return new Response(null, {
            status: 401,
            headers: { "WWW-Authenticate": `Bearer resource_metadata="${url.origin}/custom/metadata"` },
          })
        if (url.pathname === "/custom/metadata")
          return Response.json({ resource: `${url.origin}/mcp`, authorization_servers: [`${url.origin}/as`] })
        if (url.pathname === "/.well-known/oauth-authorization-server/as")
          return Response.json({
            issuer: `${url.origin}/as`,
            authorization_endpoint: `${url.origin}/as/authorize`,
            token_endpoint: `${url.origin}/as/token`,
            response_types_supported: ["code"],
          })
        return new Response(null, { status: 404 })
      },
    })
    const { url } = await Effect.runPromise(
      Effect.scoped(start(`${server.url.origin}/mcp`, { client_id: "client" })),
    ).finally(() => server.stop(true))
    expect(url.pathname).toBe("/as/authorize")
  })

  test("uses configured authorization server metadata when the resource publishes none", async () => {
    const { server: issuer } = authorizationServer({})
    const resource = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 404 }) })
    const url = `${resource.url.origin}/mcp`
    const oauth = {
      client_id: "client",
      auth_server_metadata_url: `${issuer.url.origin}/.well-known/oauth-authorization-server`,
    }

    const { url: authorization } = await Effect.runPromise(Effect.scoped(start(url, oauth)))
    expect(authorization.origin).toBe(issuer.url.origin)
    expect(authorization.pathname).toBe("/authorize")
    expect(authorization.searchParams.get("resource")).toBe(url)

    const { server, tokenRequests } = authorizationServer({})
    const store = memoryCredentials([
      credential({ access: "expired", refresh: "refresh", url, issuer: server.url.origin }),
    ])
    const oauthProvider = await connectProvider(
      new ConfigMCP.Remote({
        type: "remote",
        url,
        oauth: { ...oauth, auth_server_metadata_url: `${server.url.origin}/.well-known/oauth-authorization-server` },
      }),
      store,
    )
    await auth(oauthProvider, { serverUrl: url }).finally(() => {
      resource.stop(true)
      issuer.stop(true)
      server.stop(true)
    })
    expect(tokenRequests[0]?.get("grant_type")).toBe("refresh_token")
  })

  test("requests offline_access without forcing a consent prompt", async () => {
    const { server } = authorizationServer({ scopes_supported: ["read", "offline_access"] })
    const { url } = await Effect.runPromise(
      Effect.scoped(start(server, { client_id: "client", scope: "read" })),
    ).finally(() => server.stop(true))
    expect(url.searchParams.get("scope")).toBe("read offline_access")
    expect(url.searchParams.has("prompt")).toBe(false)
  })

  test("forwards iss from the redirect so issuer-advertising servers can complete", async () => {
    const { server } = authorizationServer({ authorization_response_iss_parameter_supported: true })
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { authorization, url } = yield* start(server)
          const redirect = new URL(url.searchParams.get("redirect_uri")!)
          redirect.searchParams.set("code", "accepted")
          redirect.searchParams.set("state", url.searchParams.get("state")!)
          redirect.searchParams.set("iss", server.url.origin)
          yield* Effect.promise(() => fetch(redirect))
          return yield* authorization.callback
        }),
      ),
    ).finally(() => server.stop(true))
    expect(result.access).toBe("access")
  })

  describe("client registration", () => {
    const cimd = { client_id_metadata_document_supported: true, token_endpoint_auth_methods_supported: ["none"] }

    test("uses the client metadata document when the server supports public CIMD clients", async () => {
      const { server, registrations, tokenRequests } = authorizationServer(cimd)
      const credential = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const { authorization, url } = yield* start(server)
            expect(url.searchParams.get("client_id")).toBe(McpOAuth.CLIENT_METADATA_URL)
            const redirect = new URL(url.searchParams.get("redirect_uri")!)
            redirect.searchParams.set("code", "accepted")
            redirect.searchParams.set("state", url.searchParams.get("state")!)
            yield* Effect.promise(() => fetch(redirect))
            return yield* authorization.callback
          }),
        ),
      ).finally(() => server.stop(true))

      expect(registrations).toHaveLength(0)
      expect(tokenRequests[0]?.get("client_id")).toBe(McpOAuth.CLIENT_METADATA_URL)
      expect(McpOAuth.clientFromCredential(credential)).toEqual({
        client_id: McpOAuth.CLIENT_METADATA_URL,
        issuer: server.url.origin,
      })
    })

    test("registers dynamically when the server does not accept public clients", async () => {
      const { server, registrations } = authorizationServer({
        client_id_metadata_document_supported: true,
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      })
      const { url } = await Effect.runPromise(Effect.scoped(start(server))).finally(() => server.stop(true))
      expect(url.searchParams.get("client_id")).toBe("registered")
      expect(registrations).toHaveLength(1)
    })

    test("reuses the client registered by an earlier login", async () => {
      const { server, registrations } = authorizationServer({})
      const previous = credential({ access: "a", refresh: "r", url: server.url.href })
      const client = { client_id: "registered", issuer: server.url.origin }
      const store = memoryCredentials([
        new Credential.Info({ ...previous, value: { ...previous.value, metadata: { client } } }),
      ])
      const { url } = await Effect.runPromise(Effect.scoped(start(server, undefined, store))).finally(() =>
        server.stop(true),
      )
      expect(url.searchParams.get("client_id")).toBe("registered")
      expect(registrations).toHaveLength(0)
    })

    test("registers dynamically when a custom redirect_uri is configured", async () => {
      const { server, registrations } = authorizationServer(cimd)
      const { url } = await Effect.runPromise(
        Effect.scoped(start(server, { redirect_uri: "http://127.0.0.1:0/custom" })),
      ).finally(() => server.stop(true))
      expect(url.searchParams.get("client_id")).toBe("registered")
      expect(registrations).toHaveLength(1)
    })
  })
})
