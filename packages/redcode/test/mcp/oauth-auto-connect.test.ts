import { expect } from "bun:test"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { CrossSpawnSpawner } from "@reddb-io/redcode-core/cross-spawn-spawner"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { Effect, Fiber } from "effect"
import { Config } from "../../src/config/config"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { McpAuth } from "../../src/mcp/auth"
import { MCP } from "../../src/mcp/index"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"
import { McpOAuthPendingProvider, McpOAuthProvider } from "../../src/mcp/oauth-provider"
import { provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const mcpTest = testEffect(
  LayerNode.compile(
    LayerNode.group([MCP.node, McpAuth.node, EventV2Bridge.node, Config.node, CrossSpawnSpawner.node, FSUtil.node]),
  ),
)

interface OAuthMcpOptions {
  capabilities?: "tools" | "resources"
  /** Issue refresh tokens, so the SDK renews instead of redirecting when a request is refused. */
  refreshTokens?: boolean
  /** Serve without OAuth; requests must carry this `x-api-key`. */
  apiKey?: string
}

function base64url(bytes: ArrayBuffer) {
  return Buffer.from(bytes).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

function serveOAuthMcp(options: OAuthMcpOptions = {}) {
  return Effect.acquireRelease(
    Effect.promise(async () => {
      const capabilities = options.capabilities ?? "tools"
      const protocol = new Server(
        { name: "oauth-auto-connect", version: "1.0.0" },
        { capabilities: capabilities === "tools" ? { tools: {} } : { resources: {} } },
      )
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
      })
      let listToolsCalls = 0
      let requiresAuth = true
      const accepted = new Set(["replacement-token"])
      let apiKey = options.apiKey
      let challenge: string | undefined
      let tokenRequests = 0
      let tokenGate: Promise<void> | undefined
      let issued = 0

      if (capabilities === "tools") {
        protocol.setRequestHandler(ListToolsRequestSchema, () => {
          listToolsCalls++
          return Promise.resolve({ tools: [{ name: "test_tool", inputSchema: { type: "object" } }] })
        })
        protocol.setRequestHandler(CallToolRequestSchema, () =>
          Promise.resolve({ content: [{ type: "text" as const, text: "ok" }] }),
        )
      }
      if (capabilities === "resources") {
        protocol.setRequestHandler(ListResourcesRequestSchema, () =>
          Promise.resolve({ resources: [{ name: "docs", uri: "docs://readme" }] }),
        )
      }

      await protocol.connect(transport)
      const http = Bun.serve({
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          const origin = url.origin
          const mcpUrl = `${origin}/mcp`

          if (
            url.pathname === "/.well-known/oauth-protected-resource/mcp" ||
            url.pathname === "/.well-known/oauth-protected-resource"
          ) {
            return Response.json({
              resource: mcpUrl,
              authorization_servers: [origin],
              scopes_supported: ["mcp"],
            })
          }
          if (url.pathname === "/.well-known/oauth-authorization-server") {
            return Response.json({
              issuer: origin,
              authorization_endpoint: `${origin}/authorize`,
              token_endpoint: `${origin}/token`,
              registration_endpoint: `${origin}/register`,
              response_types_supported: ["code"],
              grant_types_supported: ["authorization_code", "refresh_token"],
              token_endpoint_auth_methods_supported: ["none"],
              code_challenge_methods_supported: ["S256"],
              scopes_supported: ["mcp"],
            })
          }
          if (url.pathname === "/register") {
            const metadata = (await request.json()) as Record<string, unknown>
            return Response.json({ ...metadata, client_id: "replacement-client" }, { status: 201 })
          }
          if (url.pathname === "/token") {
            tokenRequests++
            if (tokenGate) await tokenGate
            const body = new URLSearchParams(await request.text())
            const token = () => {
              const value = `token-${++issued}`
              accepted.add(value)
              return {
                access_token: value,
                token_type: "Bearer",
                ...(options.refreshTokens ? { refresh_token: `refresh-${issued}`, expires_in: 3600 } : {}),
              }
            }
            if (body.get("grant_type") === "refresh_token") return Response.json(token())
            if (body.get("code") !== "valid-code") {
              return Response.json(
                { error: "invalid_grant", error_description: "Token exchange failed" },
                { status: 400 },
              )
            }
            if (challenge) {
              const digest = await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(body.get("code_verifier") ?? ""),
              )
              if (base64url(digest) !== challenge)
                return Response.json(
                  { error: "invalid_grant", error_description: "PKCE verifier mismatch" },
                  { status: 400 },
                )
            }
            return Response.json({ ...token(), access_token: "replacement-token" })
          }
          if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 })

          if (request.method === "GET") return new Response(null, { status: 405 })
          const challengeHeader = `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="mcp"`
          if (apiKey !== undefined) {
            if (request.headers.get("x-api-key") !== apiKey) return new Response("Unauthorized", { status: 401 })
            return transport.handleRequest(request)
          }
          const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "")
          if (requiresAuth && (!bearer || !accepted.has(bearer))) {
            return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": challengeHeader } })
          }
          const message = (await request
            .clone()
            .json()
            .catch(() => undefined)) as { method?: string; params?: { name?: string } } | undefined
          if (message?.method === "tools/call" && message.params?.name === "forbidden_tool") {
            return new Response("Forbidden for this tool", {
              status: 401,
              headers: { "WWW-Authenticate": challengeHeader },
            })
          }
          if (message?.method === "tools/call" && message.params?.name === "admin_tool") {
            return new Response("Insufficient scope", {
              status: 403,
              headers: {
                "WWW-Authenticate": `Bearer error="insufficient_scope", scope="mcp admin", resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
              },
            })
          }
          return transport.handleRequest(request)
        },
      })

      return {
        url: new URL("/mcp", http.url).toString(),
        allowAnonymous: () => {
          requiresAuth = false
        },
        revokeTokens: () => accepted.clear(),
        rotateApiKey: () => {
          apiKey = "rotated"
        },
        requirePkce: (authorizationUrl: string) => {
          challenge = new URL(authorizationUrl).searchParams.get("code_challenge") ?? undefined
        },
        holdTokens: () => {
          const gate = Promise.withResolvers<void>()
          tokenGate = gate.promise
          return () => {
            tokenGate = undefined
            gate.resolve()
          }
        },
        tokenRequests: () => tokenRequests,
        listToolsCalls: () => listToolsCalls,
        close: async () => {
          await http.stop(true)
          await protocol.close()
        },
      }
    }),
    (server) => Effect.promise(server.close),
  )
}

async function freeLoopbackPort() {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = probe.port!
  await probe.stop(true)
  return port
}

// Never bind the real default callback port: another redcode may be running on this machine.
const callbackPort = await freeLoopbackPort()

const remote = (url: string, enabled = true, extra: Record<string, unknown> = {}) => ({
  type: "remote" as const,
  url,
  enabled,
  oauth: { callbackPort },
  ...extra,
})

const stopOAuthCallback = Effect.addFinalizer(() => Effect.promise(() => McpOAuthCallback.stop()).pipe(Effect.ignore))

mcpTest.instance("first connect to OAuth server shows needs_auth instead of failed", () =>
  Effect.gen(function* () {
    const server = yield* serveOAuthMcp()
    const mcp = yield* MCP.Service
    const result = yield* mcp.add("test-oauth", remote(server.url))

    expect((result.status as Record<string, { status: string }>)["test-oauth"]).toEqual({ status: "needs_auth" })
  }),
)

mcpTest.instance("state() generates and persists a new state when none is saved", () =>
  Effect.gen(function* () {
    const auth = yield* McpAuth.Service
    const provider = new McpOAuthProvider(
      "test-state-gen",
      "https://example.com/mcp",
      {},
      { onRedirect: async () => {} },
      auth,
    )

    expect((yield* auth.get("test-state-gen"))?.oauthState).toBeUndefined()

    const state = yield* Effect.promise(() => provider.state())
    expect(state).toHaveLength(64)
    expect((yield* auth.get("test-state-gen"))?.oauthState).toBe(state)
  }),
)

mcpTest.instance("state() returns existing state when one is saved", () =>
  Effect.gen(function* () {
    const auth = yield* McpAuth.Service
    const provider = new McpOAuthProvider(
      "test-state-existing",
      "https://example.com/mcp",
      {},
      { onRedirect: async () => {} },
      auth,
    )

    yield* auth.updateOAuthState("test-state-existing", "pre-saved-state-value")
    expect(yield* Effect.promise(() => provider.state())).toBe("pre-saved-state-value")
  }),
)

mcpTest.instance("pending provider does not expose or overwrite existing credentials before commit", () =>
  Effect.gen(function* () {
    const auth = yield* McpAuth.Service
    const name = "test-pending-credentials"
    const url = "https://example.com/mcp"
    const provider = new McpOAuthPendingProvider(name, url, {}, { onRedirect: async () => {} }, auth)

    yield* auth.updateClientInfo(name, { clientId: "old-client" }, url)
    yield* auth.updateTokens(name, { accessToken: "old-token" }, url)

    expect(yield* Effect.promise(() => provider.clientInformation())).toBeUndefined()
    expect(yield* Effect.promise(() => provider.tokens())).toBeUndefined()
    expect((yield* auth.get(name))?.tokens?.accessToken).toBe("old-token")
    expect((yield* auth.get(name))?.clientInfo?.clientId).toBe("old-client")
  }),
)

mcpTest.instance("failed reauthentication preserves existing credentials", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const server = yield* serveOAuthMcp()
    const mcp = yield* MCP.Service
    const auth = yield* McpAuth.Service
    const name = "test-reauth-failure"

    yield* auth.updateClientInfo(name, { clientId: "dynamic-client", clientSecret: "dynamic-secret" }, server.url)
    yield* auth.updateTokens(name, { accessToken: "working-token" }, server.url)
    yield* mcp.add(name, remote(server.url))
    expect((yield* mcp.startAuth(name)).authorizationUrl).toContain("/authorize")

    expect(yield* mcp.finishAuth(name, "invalid-code")).toEqual({
      status: "failed",
      error: "OAuth completion failed: Token exchange failed",
    })
    expect((yield* auth.get(name))?.tokens?.accessToken).toBe("working-token")
    expect((yield* auth.get(name))?.clientInfo).toMatchObject({
      clientId: "dynamic-client",
      clientSecret: "dynamic-secret",
    })
  }),
)

mcpTest.instance("successful reauthentication commits replacement credentials", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const server = yield* serveOAuthMcp()
    const mcp = yield* MCP.Service
    const auth = yield* McpAuth.Service
    const name = "test-reauth-success"

    yield* auth.updateClientInfo(name, { clientId: "old-client" }, server.url)
    yield* auth.updateTokens(name, { accessToken: "old-token" }, server.url)
    yield* mcp.add(name, remote(server.url))
    expect((yield* mcp.startAuth(name)).authorizationUrl).toContain("/authorize")
    expect((yield* auth.get(name))?.tokens?.accessToken).toBe("old-token")

    expect((yield* mcp.finishAuth(name, "valid-code")).status).toBe("connected")
    const entry = yield* auth.get(name)
    expect(entry?.tokens?.accessToken).toBe("replacement-token")
    expect(entry?.clientInfo?.clientId).toBe("replacement-client")
    expect(entry?.serverUrl).toBe(server.url)
  }),
)

mcpTest.instance("auth status only reports credentials stored for the configured server URL", () =>
  Effect.gen(function* () {
    const mcp = yield* MCP.Service
    yield* mcp.add("test-status-url", remote("https://example.com/mcp", false))
    yield* McpAuth.use.updateTokens("test-status-url", { accessToken: "old-token" }, "https://old.example.com/mcp")

    expect(yield* mcp.getAuthStatus("test-status-url")).toBe("not_authenticated")

    yield* McpAuth.use.updateTokens("test-status-url", { accessToken: "current-token" }, "https://example.com/mcp")
    expect(yield* mcp.getAuthStatus("test-status-url")).toBe("authenticated")

    yield* McpAuth.use.updateTokens(
      "test-status-url",
      { accessToken: "expired-token", expiresAt: 1 },
      "https://example.com/mcp",
    )
    expect(yield* mcp.getAuthStatus("test-status-url")).toBe("expired")
  }),
)

mcpTest.instance("authenticate() stores a connected client when auth completes without redirect", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const server = yield* serveOAuthMcp()
    const mcp = yield* MCP.Service
    const name = "test-oauth-connect"
    const added = yield* mcp.add(name, remote(server.url))
    expect((added.status as Record<string, { status: string }>)[name]?.status).toBe("needs_auth")

    server.allowAnonymous()
    expect((yield* mcp.authenticate(name)).status).toBe("connected")
    expect((yield* mcp.status())[name]?.status).toBe("connected")
  }),
)

mcpTest.instance("authenticate() connects a resource-only server without listing tools", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const server = yield* serveOAuthMcp({ capabilities: "resources" })
    const mcp = yield* MCP.Service
    const name = "test-oauth-resources"
    const added = yield* mcp.add(name, remote(server.url))
    expect((added.status as Record<string, { status: string }>)[name]?.status).toBe("needs_auth")

    server.allowAnonymous()
    expect((yield* mcp.authenticate(name)).status).toBe("connected")
    expect(server.listToolsCalls()).toBe(0)
    expect(Object.keys(yield* mcp.resources())).toEqual([`${name}:docs://readme`])
  }),
)

/** Plays the browser: follow the authorization URL's redirect back to the local callback listener. */
function approve(authorizationUrl: string, code = "valid-code") {
  const url = new URL(authorizationUrl)
  const redirect = new URL(url.searchParams.get("redirect_uri")!)
  redirect.searchParams.set("code", code)
  redirect.searchParams.set("state", url.searchParams.get("state")!)
  // 0: nothing listens on the callback port any more.
  return Effect.promise(() =>
    fetch(redirect).then(
      (response) => response.status,
      () => 0,
    ),
  )
}

function until<A>(check: () => A | undefined, label: string) {
  return Effect.gen(function* () {
    // Bounded by time rather than by turns of the event loop: on a loaded runner, with other test
    // files running alongside, the callback round trip can take more than a few hundred turns.
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      const value = check()
      if (value !== undefined && value !== false) return value
      yield* Effect.yieldNow
      yield* Effect.promise(() => new Promise((resolve) => setImmediate(resolve)))
    }
    return yield* Effect.die(new Error(`timed out: ${label}`))
  })
}

mcpTest.instance("beginAuth and waitAuth finish a client-driven flow without opening a browser", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const server = yield* serveOAuthMcp()
    const mcp = yield* MCP.Service
    const name = "test-client-driven"
    yield* mcp.add(name, remote(server.url))
    expect((yield* mcp.info())[name]).toEqual({ type: "remote", tools: 0, oauth: true, auth: "not_authenticated" })

    const started = yield* mcp.beginAuth(name)
    expect(started.authorizationUrl).toContain("/authorize")
    expect(started.listening).toBe(true)
    expect(started.redirectUri).toBe(`http://127.0.0.1:${callbackPort}/mcp/oauth/callback`)
    expect(yield* mcp.waitAuth(name, started.oauthState, 10)).toEqual({ status: "pending" })

    expect(yield* approve(started.authorizationUrl)).toBe(200)
    expect(yield* mcp.waitAuth(name, started.oauthState, 5_000)).toEqual({ status: "connected" })
    expect((yield* mcp.status())[name]).toEqual({ status: "connected" })
    expect((yield* mcp.info())[name]).toEqual({ type: "remote", tools: 1, oauth: true, auth: "authenticated" })
    expect(McpOAuthCallback.isRunning()).toBe(false)
  }),
)

mcpTest.instance("a pasted code must match the attempt's state and releases the callback listener", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const server = yield* serveOAuthMcp()
    const mcp = yield* MCP.Service
    const auth = yield* McpAuth.Service
    const name = "test-pasted-code"
    yield* mcp.add(name, remote(server.url))

    const started = yield* mcp.beginAuth(name)
    expect(yield* mcp.finishAuth(name, "valid-code", "some-other-state")).toMatchObject({ status: "failed" })
    expect(server.tokenRequests()).toBe(0)

    expect((yield* mcp.finishAuth(name, "valid-code", started.oauthState)).status).toBe("connected")
    expect(yield* mcp.waitAuth(name, started.oauthState, 5_000)).toEqual({ status: "connected" })
    expect(yield* approve(started.authorizationUrl)).not.toBe(200)
    expect((yield* auth.get(name))?.oauthState).toBeUndefined()
  }),
)

mcpTest.instance("a late cancel for a replaced attempt does not end the new attempt", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const server = yield* serveOAuthMcp()
    const mcp = yield* MCP.Service
    const auth = yield* McpAuth.Service
    const name = "test-cancel-race"
    yield* auth.updateTokens(name, { accessToken: "old-token" }, server.url)
    yield* mcp.add(name, remote(server.url))

    const first = yield* mcp.beginAuth(name)
    const second = yield* mcp.beginAuth(name)
    expect(second.oauthState).not.toBe(first.oauthState)
    // The replaced dialog's cleanup lands after the new attempt registered.
    yield* mcp.cancelAuth(name, first.oauthState)
    expect(yield* mcp.waitAuth(name, first.oauthState, 10)).toMatchObject({ status: "failed" })
    expect(yield* mcp.waitAuth(name, second.oauthState, 10)).toEqual({ status: "pending" })
    expect(yield* approve(first.authorizationUrl)).not.toBe(200)

    yield* mcp.cancelAuth(name, second.oauthState)
    expect(yield* mcp.waitAuth(name, second.oauthState, 10)).toMatchObject({ status: "failed" })
    expect((yield* auth.get(name))?.tokens?.accessToken).toBe("old-token")
    expect(yield* approve(second.authorizationUrl)).not.toBe(200)
    expect(McpOAuthCallback.isRunning()).toBe(false)
  }),
)

mcpTest.instance("cancel is a no-op while a code is being exchanged", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const server = yield* serveOAuthMcp()
    const mcp = yield* MCP.Service
    const name = "test-cancel-exchange"
    yield* mcp.add(name, remote(server.url))

    const started = yield* mcp.beginAuth(name)
    const release = server.holdTokens()
    const finishing = yield* Effect.forkChild(mcp.finishAuth(name, "valid-code", started.oauthState))
    yield* until(() => server.tokenRequests() > 0, "token exchange started")
    yield* mcp.cancelAuth(name, started.oauthState)
    release()
    expect((yield* Fiber.join(finishing)).status).toBe("connected")
  }),
)

mcpTest.instance("the live connection cannot overwrite the PKCE verifier of a sign-in in progress", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const server = yield* serveOAuthMcp()
    const mcp = yield* MCP.Service
    const auth = yield* McpAuth.Service
    const name = "test-pkce"
    yield* mcp.add(name, remote(server.url))

    const started = yield* mcp.beginAuth(name)
    server.requirePkce(started.authorizationUrl)
    // What a 401 on the live client's provider does during the attempt.
    yield* auth.updateCodeVerifier(name, "verifier-from-the-live-connection")
    yield* auth.updateOAuthState(name, "state-from-the-live-connection")

    expect(yield* approve(started.authorizationUrl)).toBe(200)
    expect(yield* mcp.waitAuth(name, started.oauthState, 5_000)).toEqual({ status: "connected" })
  }),
)

mcpTest.instance("the callback listener closes when no attempt waits and reports a port held elsewhere", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const server = yield* serveOAuthMcp()
    const mcp = yield* MCP.Service
    const name = "test-listener"
    yield* mcp.add(name, remote(server.url))

    server.allowAnonymous()
    expect(yield* mcp.beginAuth(name)).toMatchObject({ authorizationUrl: "" })
    expect(McpOAuthCallback.isRunning()).toBe(false)
    expect((yield* mcp.status())[name]).toEqual({ status: "connected" })

    const other = yield* Effect.acquireRelease(
      Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: callbackPort, fetch: () => new Response("other") })),
      (probe) => Effect.promise(() => probe.stop(true)),
    )
    expect(other.port).toBe(callbackPort)
    const held = yield* serveOAuthMcp()
    yield* mcp.add("test-listener-held", remote(held.url))
    const started = yield* mcp.beginAuth("test-listener-held")
    expect(started.listening).toBe(false)
    expect(McpOAuthCallback.isRunning()).toBe(false)
    expect((yield* mcp.finishAuth("test-listener-held", "valid-code", started.oauthState)).status).toBe("connected")
  }),
)

mcpTest.instance("sign-in attempts are separate per workspace for servers with the same name", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const first = yield* serveOAuthMcp()
    const second = yield* serveOAuthMcp()
    const mcp = yield* MCP.Service
    const name = "github"
    const otherDirectory = yield* tmpdirScoped()
    const inOther = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(provideInstance(otherDirectory), Effect.provide(testInstanceStoreLayer))

    yield* mcp.add(name, remote(first.url))
    yield* inOther(mcp.add(name, remote(second.url)))
    const here = yield* mcp.beginAuth(name)
    const there = yield* inOther(mcp.beginAuth(name))

    // The other workspace's code cannot finish this workspace's transport, nor cancel its attempt.
    expect(yield* mcp.finishAuth(name, "valid-code", there.oauthState)).toMatchObject({ status: "failed" })
    yield* inOther(mcp.cancelAuth(name, there.oauthState))
    expect(yield* mcp.waitAuth(name, here.oauthState, 10)).toEqual({ status: "pending" })
    expect(yield* approve(here.authorizationUrl)).toBe(200)
    expect(yield* mcp.waitAuth(name, here.oauthState, 5_000)).toEqual({ status: "connected" })
    expect(second.tokenRequests()).toBe(0)
  }),
)

mcpTest.instance("a refresh that fails mid-session moves a connected server to needs_auth", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const server = yield* serveOAuthMcp()
    const mcp = yield* MCP.Service
    const name = "test-mid-session"
    yield* mcp.add(name, remote(server.url))
    const started = yield* mcp.beginAuth(name)
    yield* approve(started.authorizationUrl)
    expect((yield* mcp.waitAuth(name, started.oauthState, 5_000)).status).toBe("connected")

    server.revokeTokens()
    const client = (yield* mcp.clients())[name]
    yield* Effect.promise(() => client.listTools().catch(() => undefined))
    expect((yield* mcp.status())[name]).toEqual({ status: "needs_auth" })
    expect((yield* mcp.info())[name]?.tools).toBe(0)
  }),
)

mcpTest.instance("a 401 after a successful refresh is a per-tool refusal, not needs_auth", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const server = yield* serveOAuthMcp({ refreshTokens: true })
    const mcp = yield* MCP.Service
    const name = "test-per-tool-401"
    yield* mcp.add(name, remote(server.url))
    const started = yield* mcp.beginAuth(name)
    yield* approve(started.authorizationUrl)
    expect((yield* mcp.waitAuth(name, started.oauthState, 5_000)).status).toBe("connected")

    const client = (yield* mcp.clients())[name]
    const error = yield* Effect.promise(() =>
      client.callTool({ name: "forbidden_tool", arguments: {} }).then(
        () => undefined,
        (reason: unknown) => reason,
      ),
    )
    expect(String(error)).toContain("401")
    expect((yield* mcp.status())[name]).toEqual({ status: "connected" })
    expect((yield* mcp.info())[name]?.auth).toBe("authenticated")
  }),
)

mcpTest.instance("a 403 insufficient_scope that needs the browser moves the server to needs_auth", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const server = yield* serveOAuthMcp()
    const mcp = yield* MCP.Service
    const name = "test-insufficient-scope"
    yield* mcp.add(name, remote(server.url))
    const started = yield* mcp.beginAuth(name)
    yield* approve(started.authorizationUrl)
    expect((yield* mcp.waitAuth(name, started.oauthState, 5_000)).status).toBe("connected")

    const client = (yield* mcp.clients())[name]
    yield* Effect.promise(() => client.callTool({ name: "admin_tool", arguments: {} }).catch(() => undefined))
    expect((yield* mcp.status())[name]).toEqual({ status: "needs_auth" })
  }),
)

mcpTest.instance("a 401 on a server with oauth disabled fails instead of asking to sign in", () =>
  Effect.gen(function* () {
    const server = yield* serveOAuthMcp({ apiKey: "secret" })
    const mcp = yield* MCP.Service
    const name = "test-api-key"
    yield* mcp.add(name, { type: "remote", url: server.url, oauth: false, headers: { "x-api-key": "secret" } })
    expect((yield* mcp.status())[name]).toEqual({ status: "connected" })

    server.rotateApiKey()
    const client = (yield* mcp.clients())[name]
    yield* Effect.promise(() => client.listTools().catch(() => undefined))
    expect((yield* mcp.status())[name]).toEqual({
      status: "failed",
      error: "Unauthorized — check the server's headers or API key",
    })
  }),
)
