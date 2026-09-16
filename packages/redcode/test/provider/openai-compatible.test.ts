import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import type { Auth } from "../../src/auth"
import { ProviderDiscovery } from "../../src/provider/discovery"
import { OpenAICompatible } from "../../src/provider/openai-compatible"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

const it = testEffect(FetchHttpClient.layer)

function serve(fetch: (request: Request) => Response | Promise<Response>) {
  return Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch })),
    (server) => Effect.promise(() => server.stop(true)),
  )
}

type Write = { patch: Record<string, unknown>; remove: ReadonlyArray<ReadonlyArray<string>> | undefined }

function fakes(input: { data?: Record<string, unknown>; auth?: Record<string, Auth.Info> } = {}) {
  const calls: string[] = []
  const writes: Write[] = []
  const credentials: Record<string, Auth.Info> = { ...input.auth }
  const config = TestConfig.make({
    readGlobalFile: () => Effect.succeed({ path: "/home/test/.red/code/config.jsonc", data: input.data ?? {} }),
    updateGlobal: (next, options) =>
      Effect.sync(() => {
        calls.push("config")
        writes.push({ patch: next as Record<string, unknown>, remove: options?.remove })
        return { info: next, changed: true }
      }),
  })
  const auth = {
    get: (key: string) => Effect.succeed(credentials[key]),
    set: (key: string, info: Auth.Info) =>
      Effect.sync(() => {
        calls.push(`auth.set:${key}`)
        credentials[key] = info
      }),
    remove: (key: string) =>
      Effect.sync(() => {
        calls.push(`auth.remove:${key}`)
        delete credentials[key]
      }),
  } as unknown as Auth.Interface
  return { calls, writes, credentials, config, auth }
}

function provider(write: Write, id: string) {
  return (write.patch.provider as Record<string, Record<string, unknown>>)[id]
}

const api = (key: string) => ({ type: "api", key }) as Auth.Info

describe("OpenAICompatible.plan", () => {
  test("prunes only discovered entries and only when asked", () => {
    const existing = { stale: { name: "Stale" }, tuned: { name: "Tuned", options: { a: 1 } }, kept: { limit: {} } }
    const found = [{ id: "kept", name: "Kept", limit: { context: 1000, output: 100 } }]
    expect(OpenAICompatible.plan(existing, found, { prune: true }).remove).toEqual(["stale"])
    expect(OpenAICompatible.plan(existing, found, { prune: false }).remove).toEqual([])
    expect(OpenAICompatible.plan(existing, found, { prune: false }).models.kept).toEqual({})
    expect(OpenAICompatible.plan(existing, found, { prune: false, explicit: new Set(["kept"]) }).models.kept).toEqual({
      limit: { context: 1000, output: 100 },
    })
  })
})

it.effect("connects a keyless endpoint from its model list", () =>
  Effect.gen(function* () {
    const seen: Array<string | null> = []
    const server = yield* serve((request) => {
      seen.push(request.headers.get("authorization"))
      return Response.json({ data: [{ id: "llama3.1:8b", context_length: 32768 }] })
    })
    const fake = fakes()
    const http = yield* HttpClient.HttpClient
    const result = yield* OpenAICompatible.connect(
      { http, config: fake.config, auth: fake.auth },
      { providerID: "local-llm", baseURL: server.url.href.replace(/\/$/, "") },
    )
    expect(seen).toEqual([null])
    expect(result).toMatchObject({
      providerID: "local-llm",
      name: "local-llm",
      npm: "@ai-sdk/openai-compatible",
      baseURL: `${server.url.href}v1`,
      discovered: true,
      credential: "none",
      configPath: "/home/test/.red/code/config.jsonc",
    })
    expect(fake.calls).toEqual(["config"])
    expect(provider(fake.writes[0], "local-llm")).toEqual({
      npm: "@ai-sdk/openai-compatible",
      name: "local-llm",
      options: { baseURL: `${server.url.href}v1` },
      models: { "llama3.1:8b": { name: "llama3.1:8b", limit: { context: 32768, output: 8192 } } },
    })
  }),
)

it.effect("an empty model list saves nothing, and entered models are accepted without discovery", () =>
  Effect.gen(function* () {
    let requests = 0
    const server = yield* serve(() => {
      requests++
      return Response.json({ data: [] })
    })
    const fake = fakes({ data: { provider: { acme: { models: { old: { name: "Old" } } } } } })
    const http = yield* HttpClient.HttpClient
    const deps = { http, config: fake.config, auth: fake.auth }
    const input = {
      providerID: "acme",
      name: "Acme",
      baseURL: `${server.url}v1`,
      apiKey: "sk-acme",
      npm: "@ai-sdk/openai" as const,
    }
    const error = yield* OpenAICompatible.connect(deps, input).pipe(Effect.flip)
    expect(error.reason).toBe("discovery")
    expect(error.message).toContain("Enter model ids")
    expect(fake.calls).toEqual([])

    const result = yield* OpenAICompatible.connect(deps, {
      ...input,
      models: [{ id: "acme-large", context: 200000 }, { id: "acme-small" }],
    })
    expect(requests).toBe(1)
    expect(result.discovered).toBe(false)
    expect(result.credential).toBe("stored")
    expect(fake.calls).toEqual(["config", "auth.set:acme"])
    expect(fake.writes[0].remove).toEqual([])
    const models = provider(fake.writes[0], "acme").models as Record<string, { limit: { context: number } }>
    expect(models["acme-large"].limit.context).toBe(200000)
    expect(models["acme-small"].limit).toEqual(ProviderDiscovery.GUESSED_LIMIT)
    expect(provider(fake.writes[0], "acme").npm).toBe("@ai-sdk/openai")
    expect(JSON.stringify(fake.writes[0].patch)).not.toContain("sk-acme")
    expect(fake.credentials.acme).toMatchObject({ type: "api", key: "sk-acme" })
  }),
)

it.effect("drops the key and custom headers when the model list redirects to another origin", () =>
  Effect.gen(function* () {
    const seen: Array<{ where: string; auth: string | null; custom: string | null }> = []
    const other = yield* serve((request) => {
      seen.push({ where: "other", auth: request.headers.get("authorization"), custom: request.headers.get("x-team") })
      return Response.json({ data: [{ id: "redirected" }] })
    })
    const origin = yield* serve((request) => {
      const url = new URL(request.url)
      seen.push({
        where: url.pathname,
        auth: request.headers.get("authorization"),
        custom: request.headers.get("x-team"),
      })
      if (url.pathname === "/v1/models") return Response.redirect(new URL("/moved/models", url).href, 307)
      return Response.redirect(`${other.url}v1/models`, 302)
    })
    const fake = fakes()
    const http = yield* HttpClient.HttpClient
    yield* OpenAICompatible.connect(
      { http, config: fake.config, auth: fake.auth, env: (name) => (name === "TEAM" ? "team-secret" : undefined) },
      {
        providerID: "redirecting",
        baseURL: `${origin.url}v1`,
        apiKey: "secret-key",
        headers: { "x-team": "{env:TEAM}" },
      },
    )
    expect(seen).toEqual([
      { where: "/v1/models", auth: "Bearer secret-key", custom: "team-secret" },
      { where: "/moved/models", auth: "Bearer secret-key", custom: "team-secret" },
      { where: "other", auth: null, custom: null },
    ])
    // The header reference is saved as written, never its value.
    expect((provider(fake.writes[0], "redirecting").options as Record<string, unknown>).headers).toEqual({
      "x-team": "{env:TEAM}",
    })
  }),
)

it.effect("refuses invalid and built-in ids before any request, unless overriding is confirmed", () =>
  Effect.gen(function* () {
    let requests = 0
    const server = yield* serve(() => {
      requests++
      return Response.json({ data: [{ id: "m" }] })
    })
    const fake = fakes()
    const http = yield* HttpClient.HttpClient
    const deps = { http, config: fake.config, auth: fake.auth, builtIn: (id: string) => id === "openai" }
    for (const providerID of ["", "My Provider", "-dash", "a/b", "x".repeat(65)]) {
      const error = yield* OpenAICompatible.connect(deps, { providerID, baseURL: `${server.url}v1` }).pipe(Effect.flip)
      expect(error.reason).toBe("invalid_provider_id")
    }
    const refused = yield* OpenAICompatible.connect(deps, { providerID: "openai", baseURL: `${server.url}v1` }).pipe(
      Effect.flip,
    )
    expect(refused.reason).toBe("builtin_provider")
    expect(refused.message).toContain('"openai" is a built-in provider')
    for (const [input, reason] of [
      [{ baseURL: "ftp://x" }, "invalid_url"],
      [{ apiKey: "key\nx" }, "invalid_key"],
      [{ apiKey: "prefix{env:KEY}" }, "invalid_key"],
      [{ headers: { "bad header": "x" } }, "invalid_headers"],
      [{ headers: { ok: "line\r\nbreak" } }, "invalid_headers"],
      [{ models: [{ id: "has space" }] }, "invalid_models"],
      [{ models: [{ id: "m", context: -1 }] }, "invalid_models"],
      [{ models: [] }, "invalid_models"],
    ] as const) {
      const error = yield* OpenAICompatible.connect(
        deps,
        Object.assign({ providerID: "custom", baseURL: `${server.url}v1` }, input),
      ).pipe(Effect.flip)
      expect(error.reason).toBe(reason)
    }
    expect(requests).toBe(0)
    expect(fake.calls).toEqual([])
    yield* OpenAICompatible.connect(deps, { providerID: "openai", baseURL: `${server.url}v1`, override: true })
    expect(requests).toBe(1)
  }),
)

it.effect("stores an environment reference verbatim and uses its value only for discovery", () =>
  Effect.gen(function* () {
    const seen: Array<string | null> = []
    const server = yield* serve((request) => {
      seen.push(request.headers.get("authorization"))
      return Response.json({ data: [{ id: "m" }] })
    })
    const fake = fakes({
      data: { provider: { team: { options: { baseURL: `${server.url}v1` } } } },
      auth: { team: api("old-key") },
    })
    const http = yield* HttpClient.HttpClient
    const deps = {
      http,
      config: fake.config,
      auth: fake.auth,
      env: (name: string) => (name === "TEAM_KEY" ? "from-env" : undefined),
    }
    const result = yield* OpenAICompatible.connect(deps, {
      providerID: "team",
      baseURL: `${server.url}v1`,
      apiKey: "{env:TEAM_KEY}",
    })
    expect(seen).toEqual(["Bearer from-env"])
    expect(result.credential).toBe("reference")
    expect((provider(fake.writes[0], "team").options as Record<string, unknown>).apiKey).toBe("{env:TEAM_KEY}")
    expect(JSON.stringify(fake.writes[0].patch)).not.toContain("from-env")
    expect(JSON.stringify(result)).not.toContain("from-env")
    // The stored key would win over the reference, so it is removed.
    expect(fake.calls).toEqual(["config", "auth.remove:team"])

    const missing = yield* OpenAICompatible.connect(deps, {
      providerID: "team",
      baseURL: `${server.url}v1`,
      apiKey: "{env:UNSET_KEY}",
    }).pipe(Effect.flip)
    expect(missing.reason).toBe("discovery")
    expect(missing.message).toContain("UNSET_KEY is not set")
    expect(missing.message).not.toContain("from-env")
  }),
)

it.effect("reuses the saved key only for the address it was saved for", () =>
  Effect.gen(function* () {
    const seen: Array<string | null> = []
    const server = yield* serve((request) => {
      seen.push(request.headers.get("authorization"))
      return Response.json({ data: [{ id: "m" }] })
    })
    const fake = fakes({
      data: { provider: { mine: { name: "Mine", options: { baseURL: `${server.url}v1`, apiKey: "config-key" } } } },
      auth: { mine: api("saved-key") },
    })
    const http = yield* HttpClient.HttpClient
    const deps = { http, config: fake.config, auth: fake.auth }
    const moved = yield* OpenAICompatible.connect(deps, { providerID: "mine", baseURL: "http://10.0.0.9:1/v1" }).pipe(
      Effect.flip,
    )
    expect(moved.reason).toBe("invalid_key")
    expect(seen).toEqual([])

    const kept = yield* OpenAICompatible.connect(deps, { providerID: "mine", baseURL: `${server.url}v1/models` })
    expect(seen).toEqual(["Bearer saved-key"])
    expect(kept).toMatchObject({ credential: "kept", name: "Mine" })
    expect(fake.calls).toEqual(["config"])
    expect(fake.writes[0].remove).toEqual([])

    yield* OpenAICompatible.connect(deps, { providerID: "mine", baseURL: `${server.url}v1`, apiKey: "new-key" })
    expect(fake.writes[1].remove).toEqual([["provider", "mine", "options", "apiKey"]])
    expect(fake.credentials.mine).toMatchObject({ key: "new-key" })
  }),
)

it.effect("moves a connection to a new id with its settings, models, key and default model", () =>
  Effect.gen(function* () {
    const server = yield* serve(() => Response.json({ data: [{ id: "gpt-x" }] }))
    const fake = fakes({
      data: {
        model: "9router/gpt-x",
        small_model: "anthropic/haiku",
        provider: {
          "9router": {
            npm: "@ai-sdk/openai-compatible",
            name: "9Router",
            options: { baseURL: `${server.url}v1`, timeout: 60000 },
            models: { "gpt-x": { name: "GPT X", options: { reasoningEffort: "high" } } },
          },
        },
      },
      auth: { "9router": api("router-key") },
    })
    const http = yield* HttpClient.HttpClient
    const deps = { http, config: fake.config, auth: fake.auth }
    const taken = yield* OpenAICompatible.connect(deps, {
      providerID: "9router",
      baseURL: `${server.url}v1`,
      moveFrom: "9router",
    }).pipe(Effect.flip)
    expect(taken.reason).toBe("invalid_move")

    const result = yield* OpenAICompatible.connect(deps, {
      providerID: "gateway",
      name: "Gateway",
      baseURL: `${server.url}v1`,
      moveFrom: "9router",
    })
    expect(result).toMatchObject({ providerID: "gateway", credential: "kept", movedFrom: "9router" })
    expect(fake.writes[0].patch.model).toBe("gateway/gpt-x")
    expect(fake.writes[0].patch.small_model).toBeUndefined()
    expect(provider(fake.writes[0], "gateway")).toEqual({
      npm: "@ai-sdk/openai-compatible",
      name: "Gateway",
      options: { baseURL: `${server.url}v1`, timeout: 60000 },
      models: {
        "gpt-x": { name: "GPT X", options: { reasoningEffort: "high" }, limit: ProviderDiscovery.GUESSED_LIMIT },
      },
    })
    expect(fake.writes[0].remove).toEqual([["provider", "9router"]])
    expect(fake.calls).toEqual(["config", "auth.set:gateway", "auth.remove:9router"])
    expect(fake.credentials).toEqual({ gateway: api("router-key") })
  }),
)
