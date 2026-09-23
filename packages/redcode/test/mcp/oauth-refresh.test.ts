import { describe, expect, test } from "bun:test"
import { refreshAuthorization } from "@modelcontextprotocol/sdk/client/auth.js"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { Effect, Layer } from "effect"
import { McpAuth } from "../../src/mcp/auth"
import { McpOAuthProvider } from "../../src/mcp/oauth-provider"

const serverUrl = "https://mcp.example.com/mcp"

// Keeps mcp-auth.json in memory so parallel test processes never share the real file.
async function memoryAuth() {
  const state = { raw: "" }
  const fsLayer = Layer.effect(
    FSUtil.Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      return FSUtil.Service.of({
        ...fs,
        readJson: (file) =>
          file.endsWith("mcp-auth.json")
            ? Effect.try({
                try: () => {
                  if (!state.raw) throw new Error("mcp-auth.json missing")
                  return JSON.parse(state.raw)
                },
                catch: (cause) => new FSUtil.FileSystemError({ method: "readJson", cause }),
              })
            : fs.readJson(file),
        writeJson: (file, value, mode) =>
          file.endsWith("mcp-auth.json")
            ? Effect.sync(() => {
                state.raw = JSON.stringify(value)
              })
            : fs.writeJson(file, value, mode),
      })
    }),
  ).pipe(Layer.provide(AppNodeBuilder.build(FSUtil.node)))
  return Effect.runPromise(
    McpAuth.Service.use((auth) => Effect.succeed(auth)).pipe(
      Effect.provide(AppNodeBuilder.build(McpAuth.node, [[FSUtil.node, fsLayer]])),
    ),
  )
}

async function signedIn() {
  const auth = await memoryAuth()
  await Effect.runPromise(
    auth.set(
      "server",
      { tokens: { accessToken: "access-1", refreshToken: "refresh-1" }, clientInfo: { clientId: "client" } },
      serverUrl,
    ),
  )
  const provider = new McpOAuthProvider("server", serverUrl, {}, { onRedirect: async () => {} }, auth)
  return { auth, provider }
}

describe("MCP OAuth refresh", () => {
  test("shares concurrent refreshes for the same token", async () => {
    const state = { requests: 0 }
    const pending = Promise.withResolvers<void>()
    const options = {
      metadata: {
        issuer: "https://auth.example.com",
        authorization_endpoint: "https://auth.example.com/authorize",
        token_endpoint: "https://auth.example.com/token",
        response_types_supported: ["code"],
      },
      clientInformation: { client_id: "client" },
      refreshToken: "refresh",
      fetchFn: async () => {
        state.requests++
        await pending.promise
        return Response.json({ access_token: "access", token_type: "Bearer", refresh_token: "next" })
      },
    }

    const first = refreshAuthorization(new URL("https://auth.example.com"), options)
    const second = refreshAuthorization(new URL("https://auth.example.com"), options)
    await Promise.resolve()

    expect(state.requests).toBe(1)
    pending.resolve()
    expect(await Promise.all([first, second])).toEqual([
      { access_token: "access", token_type: "Bearer", refresh_token: "next" },
      { access_token: "access", token_type: "Bearer", refresh_token: "next" },
    ])
  })

  test("drops rejected tokens that are still the stored ones", async () => {
    const { auth, provider } = await signedIn()
    await provider.tokens()

    await provider.invalidateCredentials("tokens")

    const entry = await Effect.runPromise(auth.get("server"))
    expect(entry?.tokens).toBeUndefined()
    expect(entry?.clientInfo?.clientId).toBe("client")
  })

  test("keeps tokens a concurrent connection rotated after this one presented its own", async () => {
    const { auth, provider } = await signedIn()
    await provider.tokens()
    await Effect.runPromise(
      auth.updateTokens("server", { accessToken: "access-2", refreshToken: "refresh-2" }, serverUrl),
    )

    await provider.invalidateCredentials("tokens")
    await provider.invalidateCredentials("all")

    const entry = await Effect.runPromise(auth.get("server"))
    expect(entry?.tokens).toEqual({ accessToken: "access-2", refreshToken: "refresh-2" })
    expect(entry?.clientInfo?.clientId).toBe("client")
  })

  test("treats tokens the provider saved itself as the presented ones", async () => {
    const { auth, provider } = await signedIn()
    await provider.tokens()
    await provider.saveTokens({ access_token: "access-2", token_type: "Bearer", refresh_token: "refresh-2" })

    await provider.invalidateCredentials("all")

    expect(await Effect.runPromise(auth.get("server"))).toBeUndefined()
  })

  test("clears client information without touching rotated tokens", async () => {
    const { auth, provider } = await signedIn()
    await provider.tokens()
    await Effect.runPromise(
      auth.updateTokens("server", { accessToken: "access-2", refreshToken: "refresh-2" }, serverUrl),
    )

    await provider.invalidateCredentials("client")

    const entry = await Effect.runPromise(auth.get("server"))
    expect(entry?.clientInfo).toBeUndefined()
    expect(entry?.tokens).toEqual({ accessToken: "access-2", refreshToken: "refresh-2" })
  })
})
