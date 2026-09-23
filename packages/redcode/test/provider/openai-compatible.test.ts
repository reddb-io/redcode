import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import type { Auth } from "../../src/auth"
import { ProviderRouter } from "@reddb-io/redcode-core/provider/router"
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

function fakes(
  input: {
    data?: Record<string, unknown> | ((read: number) => Record<string, unknown>)
    auth?: Record<string, Auth.Info>
    failSet?: boolean
  } = {},
) {
  let reads = 0
  const calls: string[] = []
  const writes: Write[] = []
  const credentials: Record<string, Auth.Info> = { ...input.auth }
  const config = TestConfig.make({
    readGlobalFile: () =>
      Effect.sync(() => ({
        path: "/home/test/.red/code/config.jsonc",
        data: typeof input.data === "function" ? input.data(++reads) : (input.data ?? {}),
      })),
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
      Effect.suspend(() => {
        if (input.failSet) return Effect.die(new Error("auth store is read-only"))
        return Effect.void
      }).pipe(
        Effect.map(() => {
          calls.push(`auth.set:${key}`)
          credentials[key] = info
        }),
      ),
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

  test("refreshes what a router reports and still prunes models carrying only discovery fields", () => {
    const limit = { context: 1000, output: 100 }
    const existing = {
      combo: { name: "combo", limit, router: { owned_by: "combo", strategy: "smart" } },
      gone: { name: "gone", limit, router: { owned_by: "combo", strategy: "fallback" } },
    }
    const found = [
      { id: "combo", name: "combo", limit, router: { owned_by: "combo", strategy: "fallback" } },
      { id: "fresh", name: "fresh", limit, router: { thinking_levels: ["low", "high"] } },
    ]
    const result = OpenAICompatible.plan(existing, found, { prune: true })
    expect(result.models).toEqual({
      combo: { router: { owned_by: "combo", strategy: "fallback" } },
      fresh: { name: "fresh", limit, router: { thinking_levels: ["low", "high"] } },
    })
    expect(result.remove).toEqual(["gone"])
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
    expect(fake.calls).toEqual(["auth.set:gateway", "config", "auth.remove:9router"])
    expect(fake.credentials).toEqual({ gateway: api("router-key") })
  }),
)

it.effect("saved headers never follow the connection to a new URL, and given headers replace them", () =>
  Effect.gen(function* () {
    const seen: Array<string | null> = []
    const server = yield* serve((request) => {
      seen.push(request.headers.get("x-api-key"))
      return Response.json({ data: [{ id: "m" }] })
    })
    const saved = {
      provider: {
        team: {
          options: { baseURL: "https://old.example.com/v1", headers: { "X-Api-Key": "{env:A_KEY}", "X-Org": "a" } },
          models: { m: { name: "m", limit: { context: 1000, output: 100 } } },
        },
      },
    }
    const fake = fakes({ data: saved, auth: { team: api("old-key") } })
    const http = yield* HttpClient.HttpClient
    const deps = { http, config: fake.config, auth: fake.auth, env: () => "a-secret" }
    yield* OpenAICompatible.connect(deps, { providerID: "team", baseURL: `${server.url}v1`, apiKey: "new-key" })
    expect(seen).toEqual([null])
    expect((provider(fake.writes[0], "team").options as Record<string, unknown>).headers).toBeUndefined()
    expect(fake.writes[0].remove).toEqual([
      ["provider", "team", "options", "headers", "X-Api-Key"],
      ["provider", "team", "options", "headers", "X-Org"],
    ])

    yield* OpenAICompatible.connect(deps, {
      providerID: "team",
      baseURL: `${server.url}v1`,
      apiKey: "new-key",
      headers: { "X-Org": "b" },
    })
    expect((provider(fake.writes[1], "team").options as Record<string, unknown>).headers).toEqual({ "X-Org": "b" })
    expect(fake.writes[1].remove).toEqual([["provider", "team", "options", "headers", "X-Api-Key"]])

    const moved = fakes({ data: { provider: { "9router": saved.provider.team } }, auth: { "9router": api("k") } })
    yield* OpenAICompatible.connect(
      { ...deps, config: moved.config, auth: moved.auth },
      { providerID: "gateway", baseURL: `${server.url}v1`, apiKey: "gateway-key", moveFrom: "9router" },
    )
    expect(provider(moved.writes[0], "gateway").options).toEqual({ baseURL: `${server.url}v1` })
  }),
)

it.effect("refuses literal secrets in credential headers", () =>
  Effect.gen(function* () {
    const fake = fakes()
    const http = yield* HttpClient.HttpClient
    for (const name of ["Authorization", "x-api-key", "Api-Key", "Proxy-Authorization"]) {
      const error = yield* OpenAICompatible.connect(
        { http, config: fake.config, auth: fake.auth },
        { providerID: "team", baseURL: "http://127.0.0.1:1/v1", headers: { [name]: "Bearer literal" } },
      ).pipe(Effect.flip)
      expect(error.reason).toBe("invalid_headers")
      expect(error.message).toContain("{env:")
    }
    expect(fake.calls).toEqual([])
  }),
)

it.effect("overriding a built-in provider with a saved login needs a second confirmation", () =>
  Effect.gen(function* () {
    const server = yield* serve(() => Response.json({ data: [{ id: "gpt-proxy" }] }))
    const oauth = { type: "oauth", refresh: "r", access: "a", expires: 1 } as Auth.Info
    const fake = fakes({ auth: { openai: oauth } })
    const http = yield* HttpClient.HttpClient
    const deps = { http, config: fake.config, auth: fake.auth, builtIn: (id: string) => id === "openai" }
    const input = { providerID: "openai", baseURL: `${server.url}v1`, override: true }
    for (const apiKey of ["sk-proxy", "{env:PROXY_KEY}", ""]) {
      const error = yield* OpenAICompatible.connect(deps, { ...input, apiKey }).pipe(Effect.flip)
      expect(error.reason).toBe("credential_in_use")
      expect(error.message).toContain("replaces its saved login")
      expect(error.message).toContain("all openai models will be sent to this URL")
    }
    expect(fake.calls).toEqual([])
    expect(fake.credentials.openai).toBe(oauth)

    yield* OpenAICompatible.connect(deps, { ...input, apiKey: "sk-proxy", replaceCredential: true })
    expect(fake.credentials.openai).toMatchObject({ type: "api", key: "sk-proxy" })
  }),
)

it.effect("a move with a reference or no key removes a stale credential under the new id", () =>
  Effect.gen(function* () {
    const server = yield* serve(() => Response.json({ data: [{ id: "m" }] }))
    const http = yield* HttpClient.HttpClient
    for (const apiKey of ["{env:GATEWAY_KEY}", ""]) {
      const fake = fakes({
        data: { provider: { "9router": { options: { baseURL: `${server.url}v1` } } } },
        auth: { "9router": api("router-key"), gateway: api("stale-key") },
      })
      const result = yield* OpenAICompatible.connect(
        { http, config: fake.config, auth: fake.auth, env: () => "from-env" },
        { providerID: "gateway", baseURL: `${server.url}v1`, apiKey, moveFrom: "9router" },
      )
      expect(result.credential).toBe(apiKey ? "reference" : "none")
      expect(fake.calls).toEqual(["auth.remove:gateway", "config", "auth.remove:9router"])
      expect(fake.credentials).toEqual({})
    }
  }),
)

it.effect("a failed credential write during a move leaves the old provider and its key untouched", () =>
  Effect.gen(function* () {
    const server = yield* serve(() => Response.json({ data: [{ id: "m" }] }))
    const fake = fakes({
      data: { provider: { "9router": { options: { baseURL: `${server.url}v1` } } } },
      auth: { "9router": api("router-key") },
      failSet: true,
    })
    const http = yield* HttpClient.HttpClient
    const exit = yield* OpenAICompatible.connect(
      { http, config: fake.config, auth: fake.auth },
      { providerID: "gateway", baseURL: `${server.url}v1`, moveFrom: "9router" },
    ).pipe(Effect.exit)
    expect(exit._tag).toBe("Failure")
    expect(fake.writes).toEqual([])
    expect(fake.credentials).toEqual({ "9router": api("router-key") })
  }),
)

it.effect("builds the change from the configuration as it is after discovery", () =>
  Effect.gen(function* () {
    const server = yield* serve(() => Response.json({ data: [{ id: "m" }] }))
    const fake = fakes({
      data: (read) => ({
        provider: {
          local: {
            options: { baseURL: `${server.url}v1` },
            models: read === 1 ? { old: { name: "old" } } : { old: { name: "old", options: { tuned: true } } },
          },
        },
      }),
    })
    const http = yield* HttpClient.HttpClient
    yield* OpenAICompatible.connect(
      { http, config: fake.config, auth: fake.auth },
      {
        providerID: "local",
        baseURL: `${server.url}v1`,
      },
    )
    // The model was customized while the list was being fetched, so it is kept.
    expect(fake.writes[0].remove).toEqual([])
  }),
)

it.effect("connecting again takes the provider off disabled_providers", () =>
  Effect.gen(function* () {
    const server = yield* serve(() => Response.json({ data: [{ id: "model-a" }] }))
    const http = yield* HttpClient.HttpClient
    const baseURL = server.url.href.replace(/\/$/, "")
    const shared = fakes({ data: { disabled_providers: ["local-llm", "other"] } })
    yield* OpenAICompatible.connect(
      { http, config: shared.config, auth: shared.auth },
      { providerID: "local-llm", baseURL },
    )
    expect(shared.writes[0].patch.disabled_providers).toEqual(["other"])
    expect(shared.writes[0].remove).toEqual([])

    const alone = fakes({ data: { disabled_providers: ["local-llm"] } })
    yield* OpenAICompatible.connect(
      { http, config: alone.config, auth: alone.auth },
      { providerID: "local-llm", baseURL },
    )
    expect(alone.writes[0].patch.disabled_providers).toBeUndefined()
    expect(alone.writes[0].remove).toEqual([["disabled_providers"]])
  }),
)

describe("renameReferences", () => {
  test("points models, agents, commands and provider lists at the new id", () => {
    expect(
      OpenAICompatible.renameReferences(
        {
          model: "9router/a",
          small_model: "other/b",
          agent: { build: { model: "9router/c" }, plan: { model: "anthropic/d" }, bare: {} },
          command: { review: { model: "9router/e", template: "x" } },
          enabled_providers: ["9router", "anthropic"],
          disabled_providers: ["9router-old", "gateway"],
        },
        "9router",
        "gateway",
      ),
    ).toEqual({
      model: "gateway/a",
      agent: { build: { model: "gateway/c" } },
      command: { review: { model: "gateway/e" } },
      enabled_providers: ["gateway", "anthropic"],
    })
  })
})

describe("renameModelReferences", () => {
  test("points the connection's renamed models at their new ids and leaves everything else", () => {
    expect(
      OpenAICompatible.renameModelReferences(
        {
          model: "red-router/cx/gpt-5.6-sol",
          small_model: "red-router/kept",
          agent: { build: { model: "red-router/cc/claude-sonnet" }, plan: { model: "other/cx/gpt-5.6-sol" } },
          command: { review: { model: "red-router/cx/gpt-5.6-sol-review" } },
        },
        "red-router",
        {
          "cx/gpt-5.6-sol": "codex/gpt-5.6-sol",
          "cc/claude-sonnet": "claude-code/claude-sonnet",
          "cx/gpt-5.6-sol-review": "codex/gpt-5.6-sol",
        },
      ),
    ).toEqual({
      model: "red-router/codex/gpt-5.6-sol",
      agent: { build: { model: "red-router/claude-code/claude-sonnet" } },
      command: { review: { model: "red-router/codex/gpt-5.6-sol" } },
    })
  })
})

describe("OpenAICompatible.plan with renamed router ids", () => {
  const limit = { context: 400_000, output: 128_000 }
  const sol = {
    id: "codex/gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    limit,
    router: {
      owned_by: "codex",
      provider: { id: "codex", slug: "codex", prefix: "cx", name: "OpenAI Codex", subscription: true },
      aliases: ["cx/gpt-5.6-sol"],
      variants: [{ id: "codex/gpt-5.6-sol-review", mode: "review", aliases: ["cx/gpt-5.6-sol-review"] }],
    },
  }

  test("moves a saved model to its new id with what it carried, instead of pruning it", () => {
    const existing = {
      "cx/gpt-5.6-sol": { name: "cx/gpt-5.6-sol", limit, options: { store: false }, router: { owned_by: "cx" } },
      "cx/gpt-5.6-sol-review": { name: "cx/gpt-5.6-sol-review", limit },
      "cx/gone": { name: "cx/gone", limit },
    }
    const result = OpenAICompatible.plan(existing, [sol], { prune: true })
    expect(result.models["codex/gpt-5.6-sol"]).toEqual({
      name: "GPT-5.6 Sol",
      limit,
      options: { store: false },
      router: sol.router,
    })
    expect(result.renamed).toEqual({
      "cx/gpt-5.6-sol": "codex/gpt-5.6-sol",
      "cx/gpt-5.6-sol-review": "codex/gpt-5.6-sol",
    })
    expect(result.moved).toEqual({ "cx/gpt-5.6-sol": "codex/gpt-5.6-sol" })
    expect(result.remove.toSorted()).toEqual(["cx/gone", "cx/gpt-5.6-sol", "cx/gpt-5.6-sol-review"])
  })

  test("keeps a name someone chose when the model moves", () => {
    const existing = { "cx/gpt-5.6-sol": { name: "My Sol", limit } }
    expect(OpenAICompatible.plan(existing, [sol], { prune: true }).models["codex/gpt-5.6-sol"]).toMatchObject({
      name: "My Sol",
    })
  })

  test("a model already saved under its new id stays as it is and only the old entry goes", () => {
    const existing = {
      "codex/gpt-5.6-sol": { name: "Sol", limit },
      "cx/gpt-5.6-sol": { name: "cx/gpt-5.6-sol", limit },
    }
    const result = OpenAICompatible.plan(existing, [sol], { prune: true })
    expect(result.models["codex/gpt-5.6-sol"]).toEqual({ router: sol.router })
    expect(result.moved).toEqual({})
    expect(result.renamed).toEqual({ "cx/gpt-5.6-sol": "codex/gpt-5.6-sol" })
    expect(result.remove).toEqual(["cx/gpt-5.6-sol"])
  })

  test("an id-named model takes the router's name", () => {
    const existing = { "codex/gpt-5.6-sol": { name: "codex/gpt-5.6-sol", limit } }
    expect(OpenAICompatible.plan(existing, [sol], { prune: true }).models["codex/gpt-5.6-sol"]).toEqual({
      name: "GPT-5.6 Sol",
      router: sol.router,
    })
  })
})

it.effect("a router connection saves what answered, moves renamed models and the references to them", () =>
  Effect.gen(function* () {
    const server = yield* serve((request) => {
      const path = new URL(request.url).pathname
      if (path === "/v1/capabilities")
        return Response.json({ product: "red-router", version: "3.4.0", instance_id: "inst-1" })
      if (path === "/v1/models")
        return Response.json({
          data: [
            {
              id: "codex/gpt-5.6-sol",
              name: "GPT-5.6 Sol",
              owned_by: "codex",
              provider: { id: "codex", slug: "codex", prefix: "cx", name: "OpenAI Codex", subscription: true },
              aliases: ["cx/gpt-5.6-sol"],
              parameters: { context_length: 400000, max_completion_tokens: 128000, modes: ["review"] },
            },
            { id: "claude-code/claude-sonnet", name: "Claude Sonnet", aliases: ["cc/claude-sonnet"] },
          ],
        })
      return new Response("not found", { status: 404 })
    })
    const baseURL = `${server.url.href}v1`
    const fake = fakes({
      data: {
        model: "rr/cx/gpt-5.6-sol",
        agent: { build: { model: "rr/cc/claude-sonnet" } },
        provider: {
          rr: {
            name: "RedRouter",
            options: { baseURL },
            models: {
              "cx/gpt-5.6-sol": { name: "cx/gpt-5.6-sol", limit: { context: 400000, output: 128000 } },
              "cc/claude-sonnet": { name: "cc/claude-sonnet", limit: { context: 200000, output: 64000 } },
            },
          },
        },
      },
      auth: { rr: { type: "api", key: "router-key", metadata: { baseURL } } as Auth.Info },
    })
    const http = yield* HttpClient.HttpClient
    const result = yield* OpenAICompatible.connect(
      { http, config: fake.config, auth: fake.auth },
      { providerID: "rr", baseURL },
      { detect: true },
    )
    const write = fake.writes[0]
    expect(provider(write, "rr").router).toEqual({ kind: "red-router", version: "3.4.0", instanceID: "inst-1" })
    const models = provider(write, "rr").models as Record<string, Record<string, unknown>>
    expect(Object.keys(models).toSorted()).toEqual(["claude-code/claude-sonnet", "codex/gpt-5.6-sol"])
    expect(models["codex/gpt-5.6-sol"]).toMatchObject({
      name: "GPT-5.6 Sol",
      router: { provider: { id: "codex", name: "OpenAI Codex", subscription: true }, aliases: ["cx/gpt-5.6-sol"] },
    })
    expect(write.patch.model).toBe("rr/codex/gpt-5.6-sol")
    expect(write.patch.agent).toEqual({ build: { model: "rr/claude-code/claude-sonnet" } })
    expect(write.remove).toEqual(
      expect.arrayContaining([
        ["provider", "rr", "models", "cx/gpt-5.6-sol"],
        ["provider", "rr", "models", "cc/claude-sonnet"],
      ]),
    )
    expect(result.changes).toEqual({
      added: 0,
      removed: 0,
      renamed: { "cx/gpt-5.6-sol": "codex/gpt-5.6-sol", "cc/claude-sonnet": "claude-code/claude-sonnet" },
    })
    // The kept key learns which router it belongs to.
    expect(fake.credentials.rr).toMatchObject({ metadata: { baseURL, router: "red-router" } })
  }).pipe(Effect.ensuring(Effect.sync(() => ProviderRouter.forget()))),
)
