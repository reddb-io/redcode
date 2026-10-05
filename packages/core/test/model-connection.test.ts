import { expect, test } from "bun:test"
import { LLM } from "@opencode/ai"
import { Config } from "@opencode/core/config"
import { Credential } from "@opencode/core/credential"
import { Bus } from "@opencode/core/bus"
import { Integration } from "@opencode/core/integration"
import { KV } from "@opencode/core/kv"
import { Model } from "@opencode/core/model"
import { ModelResolver } from "@opencode/core/model-resolver"
import { ModelsDev } from "@opencode/core/models-dev"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { connectionModel, RedRouterPlugin } from "@opencode/core/plugin/provider/red-router"
import { Provider } from "@opencode/core/provider"
import { Document, Info } from "@opencode/schema/config"
import { Effect, Fiber, Layer, Schedule, Schema, Stream } from "effect"
import { TestClock } from "effect/testing"
import { Hash } from "@opencode/util/hash"
import { Headers } from "effect/unstable/http"
import { PluginTestLayer } from "./plugin/fixture"
import { advance, drain } from "./lib/clock"
import { testEffect } from "./lib/effect"
import { withEnv } from "./fixture/env"
import { SessionProviderContext } from "@opencode/core/session/provider-context"

const it = testEffect(ModelResolver.layer.pipe(Layer.provideMerge(PluginTestLayer)))

/** A models catalog that knows only these models. */
const catalogOf = (
  ...models: Array<{ provider: string; id: string; context: number; output: number }>
): ModelsDev.Snapshot[] =>
  models.map((model) => ({
    info: { ...Provider.Info.empty(Provider.ID.make(model.provider)), name: model.provider },
    models: [
      {
        ...Model.Info.default(Provider.ID.make(model.provider), Model.ID.make(model.id)),
        limit: { context: model.context, output: model.output },
      },
    ],
    environment: [],
  }))

/** A catalog service whose contents the test replaces, announcing each replacement like a refresh does. */
const replaceableCatalog = Effect.fn(function* (initial: readonly ModelsDev.Snapshot[]) {
  const bus = yield* Bus.Service
  const state = { value: initial }
  return {
    service: ModelsDev.Service.of({ get: () => Effect.sync(() => state.value), refresh: () => Effect.void }),
    replace: (next: readonly ModelsDev.Snapshot[]) =>
      Effect.suspend(() => {
        state.value = next
        return bus.publish(ModelsDev.Event.Refreshed, {})
      }),
  }
})

/** Two router accounts on one server: the first lists models the router does not describe, the second another. */
const twoAccountRouter = Effect.fn(function* (requests: Set<string>) {
  return yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: (request) => {
          const url = new URL(request.url)
          if (!url.pathname.endsWith("/models")) return new Response(null, { status: 404 })
          requests.add(url.pathname)
          return Response.json({
            data: url.pathname.startsWith("/first/")
              ? [{ id: "zai/glm-5.3-flash" }, { id: "local/qwen", context_length: 32_000, max_output_tokens: 4_000 }]
              : [{ id: "other/model", context_length: 64_000 }],
          })
        },
      }),
    ),
    (server) => Effect.promise(() => server.stop(true)),
  )
})

const waitForCatalog = Effect.fn(function* (count: number) {
  const models = yield* Model.Service
  const observed = { count: 0 }
  const fiber = yield* models.available().pipe(
    Effect.tap((catalog) =>
      Effect.sync(() => {
        observed.count = catalog.filter((model) => model.providerID === "red-router").length
      }),
    ),
    Effect.repeat(Schedule.spaced("1 millis")),
    Effect.forkScoped,
  )
  yield* advance(() => observed.count === count)
  yield* Fiber.interrupt(fiber)
  yield* drain
  return (yield* models.available()).filter((model) => model.providerID === "red-router")
})

const waitForStoredCatalog = Effect.fn(function* (key: string, count: number) {
  const kv = yield* KV.Service
  const stored = { count: 0 }
  const fiber = yield* kv.get(`${key}:count`).pipe(
    Effect.tap((value) => Effect.sync(() => (stored.count = typeof value === "number" ? value : 0))),
    Effect.repeat(Schedule.spaced("1 millis")),
    Effect.forkScoped,
  )
  yield* advance(() => stored.count === count)
  yield* Fiber.interrupt(fiber)
})

test("model references preserve saved access and remain compatible with unbound references", () => {
  const decode = Schema.decodeUnknownSync(Model.Ref)
  const encode = Schema.encodeSync(Model.Ref)
  expect(encode(decode({ providerID: "openai", id: "chat" }))).toEqual({ providerID: "openai", id: "chat" })
  const selected = { providerID: "openai", id: "chat", connection: { type: "credential" as const, id: "cred_saved" } }
  expect(encode(decode(selected))).toEqual(selected)
})

const authorization = (resolved: ModelResolver.Resolved) =>
  resolved.model.route.auth.apply({
    request: LLM.request({ model: resolved.model, prompt: "Hello" }),
    method: "POST",
    url: resolved.model.route.endpoint.baseURL ?? "",
    body: "{}",
    headers: Headers.fromInput(resolved.model.route.defaults.headers),
  })

it.effect("a saved model uses its selected account after another account becomes active", () =>
  Effect.gen(function* () {
    const credentials = yield* Credential.Service
    const integrations = yield* Integration.Service
    const providers = yield* Provider.Service
    const resolver = yield* ModelResolver.Service
    const providerID = Provider.ID.make("connection-test")
    const integrationID = Integration.ID.make(providerID)
    yield* integrations.transform((editor) =>
      editor.update(integrationID, (entry) => {
        entry.name = "Test"
      }),
    )
    const selected = {
      ...Model.Info.default(providerID, Model.ID.make("chat")),
      package: "@opencode/ai/providers/openai-compatible",
    }
    yield* providers.transform((editor) =>
      editor.add({
        info: {
          ...Provider.Info.empty(providerID),
          integrationID,
          package: selected.package,
          settings: { baseURL: "https://test.invalid/v1" },
        },
        models: [selected],
      }),
    )
    const first = yield* credentials.create({ integrationID, value: { type: "key", key: "first-key" } })
    const pinned = yield* ModelResolver.bind(Model.Ref.make({ providerID, id: selected.id }))
    const second = yield* credentials.create({ integrationID, value: { type: "key", key: "second-key" } })
    const resolved = yield* resolver.resolveModel(selected, undefined, pinned.connection)
    expect(pinned.connection).toEqual({ type: "credential", id: first.id })
    expect(resolved.ref.connection).toEqual(pinned.connection)
    expect((yield* authorization(resolved)).authorization).toBe("Bearer first-key")
    const other = yield* resolver.resolveModel(selected, undefined, { type: "credential", id: second.id })
    const checkpoint = SessionProviderContext.provenance(resolved)
    expect(checkpoint).toBeDefined()
    if (!checkpoint) return yield* Effect.die("The native checkpoint has no provenance")
    expect(SessionProviderContext.compatible(checkpoint, SessionProviderContext.provenance(other))).toBe(false)
    expect(yield* integrations.connection.active(integrationID)).toMatchObject({ type: "credential", id: second.id })
    yield* credentials.remove(first.id)
    const error = yield* resolver.resolveModel(selected, undefined, pinned.connection).pipe(Effect.flip)
    expect(error.message).toContain("selected connection is unavailable")
  }),
)

it.effect("router selections keep their endpoint, catalog and limits when the active account changes", () =>
  withEnv({ RED_ROUTER_API_KEY: undefined, RED_ROUTER_BASE_URL: undefined }, () =>
    Effect.gen(function* () {
      const requests = new Set<string>()
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch: (request) => {
              const url = new URL(request.url)
              if (!url.pathname.endsWith("/models")) return new Response(null, { status: 404 })
              requests.add(url.pathname)
              const first = url.pathname.startsWith("/first/")
              expect(request.headers.get("authorization")).toBe(first ? "Bearer first-key" : "Bearer second-key")
              return Response.json({
                data: [{ id: first ? "first-model" : "second-model", context_length: first ? 32_000 : 64_000 }],
              })
            },
          }),
        ),
        (server) => Effect.promise(() => server.stop(true)),
      )
      const credentials = yield* Credential.Service
      const models = yield* Model.Service
      const resolver = yield* ModelResolver.Service
      const integrationID = Integration.ID.make("red-router")
      const first = yield* credentials.create({
        integrationID,
        value: { type: "key", key: "first-key", configuration: { baseURL: `${server.url.origin}/first/v1` } },
      })
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin)
      yield* RedRouterPlugin.effect(host)
      yield* advance(() => requests.has("/first/v1/models"))
      yield* drain
      const pinned = yield* ModelResolver.bind(
        Model.Ref.make({ providerID: Provider.ID.make("red-router"), id: Model.ID.make("first-model") }),
      )
      yield* credentials.create({
        integrationID,
        value: { type: "key", key: "second-key", configuration: { baseURL: `${server.url.origin}/second/v1` } },
      })
      yield* advance(() => requests.has("/second/v1/models"))
      yield* drain
      expect((yield* models.available()).some((model) => model.id === "first-model")).toBe(false)
      const resolved = yield* resolver.resolve(pinned)
      expect(resolved?.ref.connection).toEqual({ type: "credential", id: first.id })
      expect(resolved?.model.route.endpoint.baseURL).toBe(`${server.url.origin}/first/v1`)
      expect(resolved?.limit.context).toBe(32_000)
      if (!resolved) return yield* Effect.die("The saved connection did not resolve")
      expect((yield* authorization(resolved)).authorization).toBe("Bearer first-key")
      const missing = yield* resolver.resolve({ ...pinned, id: Model.ID.make("second-model") }).pipe(Effect.flip)
      expect(missing.message).toContain("this connection's cached catalog")
    }),
  ),
)

it.effect("a 2505-model connection persists every chunk and reopens while its router is unavailable", () =>
  withEnv({ RED_ROUTER_API_KEY: undefined, RED_ROUTER_BASE_URL: undefined }, () =>
    Effect.gen(function* () {
      const state = { offline: false, failures: 0 }
      const catalog = Array.from({ length: 2505 }, (_, index) => ({
        id: Model.ID.make(`router/model-${index}`),
        context_length: 32_000,
      }))
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch: (request) => {
              const url = new URL(request.url)
              if (url.pathname !== "/v1/models") return new Response(null, { status: 404 })
              expect(request.headers.get("authorization")).toBe("Bearer saved-key")
              expect(url.searchParams.get("capabilities")).toBe("chat")
              if (state.offline) {
                state.failures++
                return new Response(null, { status: 503 })
              }
              return Response.json({ data: catalog })
            },
          }),
        ),
        (server) => Effect.promise(() => server.stop(true)),
      )
      const credentials = yield* Credential.Service
      const models = yield* Model.Service
      const kv = yield* KV.Service
      const resolver = yield* ModelResolver.Service
      const mount = Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        const host = yield* PluginHost.make(plugin)
        yield* RedRouterPlugin.effect(host)
      })
      const baseURL = `${server.url.origin}/v1`
      const cacheKey = `red-router:models:${Hash.sha256(`${baseURL}\nsaved-key`)}`
      const pinned = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* mount
          expect((yield* models.available()).filter((model) => model.providerID === "red-router")).toEqual([])
          yield* credentials.create({
            integrationID: Integration.ID.make("red-router"),
            value: { type: "key", key: "saved-key", configuration: { baseURL } },
          })
          expect(new Set((yield* waitForCatalog(catalog.length)).map((model) => model.id))).toEqual(
            new Set(catalog.map((model) => model.id)),
          )
          yield* waitForStoredCatalog(cacheKey, 26)
          expect(yield* kv.get(`${cacheKey}:count`)).toBe(26)
          expect(yield* kv.get(`${cacheKey}:resolved:count`)).toBe(26)
          return yield* ModelResolver.bind(
            Model.Ref.make({ providerID: Provider.ID.make("red-router"), id: Model.ID.make("router/model-2504") }),
          )
        }),
      )
      expect((yield* models.available()).filter((model) => model.providerID === "red-router")).toEqual([])
      state.offline = true
      yield* mount
      expect(new Set((yield* waitForCatalog(catalog.length)).map((model) => model.id))).toEqual(
        new Set(catalog.map((model) => model.id)),
      )
      expect(state.failures).toBeGreaterThan(0)
      const resolved = yield* resolver.resolve(pinned)
      if (!resolved) return yield* Effect.die("The reopened catalog did not resolve")
      expect(resolved.ref).toEqual(pinned)
      expect(resolved.limit.context).toBe(32_000)
      expect(resolved.model.route.endpoint.baseURL).toBe(baseURL)
      expect((yield* authorization(resolved)).authorization).toBe("Bearer saved-key")
    }),
  ),
)

it.effect("resolves a saved model without reading unrelated catalog chunks", () =>
  Effect.gen(function* () {
    const credentials = yield* Credential.Service
    const kv = yield* KV.Service
    const providerID = Provider.ID.make("red-router")
    const credential = yield* credentials.create({
      integrationID: Integration.ID.make(providerID),
      value: { type: "key", key: "saved-key", configuration: { baseURL: "https://router.invalid/v1" } },
    })
    const cacheKey = `red-router:models:${Hash.sha256("https://router.invalid/v1\nsaved-key")}`
    const selected = Model.Info.default(providerID, Model.ID.make("first-model"))
    yield* kv.set(`${cacheKey}:resolved:count`, 26)
    yield* kv.set(`${cacheKey}:resolved:0`, [Schema.encodeSync(Schema.toCodecJson(Model.Info))(selected)])
    const reads: string[] = []
    const resolved = yield* connectionModel(
      providerID,
      selected.id,
      { type: "credential", id: credential.id, label: credential.label, method: "key" },
      credential.value,
    ).pipe(
      Effect.provideService(
        KV.Service,
        KV.Service.of({
          ...kv,
          get: (key) => {
            reads.push(key)
            return kv.get(key)
          },
        }),
      ),
    )
    expect(resolved?.id).toBe(selected.id)
    expect(reads).toEqual([`${cacheKey}:resolved:count`, `${cacheKey}:resolved:0`])
  }),
)

it.effect("an unchanged large router catalog does not rebuild definitions or invalidate clients", () =>
  withEnv({ RED_ROUTER_API_KEY: undefined, RED_ROUTER_BASE_URL: undefined }, () =>
    Effect.gen(function* () {
      const state = { requests: 0, updates: 0 }
      const catalog = Array.from({ length: 2505 }, (_, index) => ({ id: `router/model-${index}` }))
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch: (request) => {
              if (new URL(request.url).pathname !== "/v1/models") return new Response(null, { status: 404 })
              state.requests++
              return Response.json({ data: catalog })
            },
          }),
        ),
        (server) => Effect.promise(() => server.stop(true)),
      )
      const credentials = yield* Credential.Service
      const models = yield* Model.Service
      const providers = yield* Provider.Service
      const plugin = yield* Plugin.Service
      const kv = yield* KV.Service
      const bus = yield* Bus.Service
      const reads: string[] = []
      yield* credentials.create({
        integrationID: Integration.ID.make("red-router"),
        value: { type: "key", key: "saved-key", configuration: { baseURL: `${server.url.origin}/v1` } },
      })
      const host = yield* PluginHost.make(plugin)
      yield* RedRouterPlugin.effect(host).pipe(
        Effect.provideService(
          KV.Service,
          KV.Service.of({
            ...kv,
            get: (key) => {
              reads.push(key)
              return kv.get(key)
            },
          }),
        ),
      )
      yield* waitForCatalog(catalog.length)
      yield* waitForStoredCatalog(`red-router:models:${Hash.sha256(`${server.url.origin}/v1\nsaved-key`)}`, 26)
      const before = yield* models.available()
      const readsBefore = reads.filter((key) => /:models:.*:\d+$/.test(key)).length
      yield* bus.subscribe(Provider.Event.Updated).pipe(
        Stream.runForEach(() => Effect.sync(() => state.updates++)),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* TestClock.adjust("5 minutes")
      yield* advance(() => state.requests > 1)
      yield* drain
      expect(yield* models.available()).toBe(before)
      expect(state.updates).toBe(0)
      expect(reads.filter((key) => /:models:.*:\d+$/.test(key))).toHaveLength(readsBefore)
      const definitions = (yield* providers.snapshot()).records.get(Provider.ID.make("red-router"))?.models
      yield* providers.reload()
      expect((yield* providers.snapshot()).records.get(Provider.ID.make("red-router"))?.models).toBe(definitions)
    }),
  ),
)

it.effect("an older raw catalog becomes resolvable on upgrade without a successful router request", () =>
  withEnv({ RED_ROUTER_API_KEY: undefined, RED_ROUTER_BASE_URL: undefined }, () =>
    Effect.gen(function* () {
      const state = { requests: 0 }
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch: () => {
              state.requests++
              return new Response(null, { status: 503 })
            },
          }),
        ),
        (server) => Effect.promise(() => server.stop(true)),
      )
      const credentials = yield* Credential.Service
      const kv = yield* KV.Service
      const resolver = yield* ModelResolver.Service
      const baseURL = `${server.url.origin}/v1`
      const credential = yield* credentials.create({
        integrationID: Integration.ID.make("red-router"),
        value: { type: "key", key: "saved-key", configuration: { baseURL } },
      })
      const cacheKey = `red-router:models:${Hash.sha256(`${baseURL}\nsaved-key`)}`
      yield* kv.set(`${cacheKey}:0`, [{ id: "legacy/model", context_length: 64_000 }])
      yield* kv.set(`${cacheKey}:count`, 1)
      expect(yield* kv.get(`${cacheKey}:resolved:count`)).toBeUndefined()
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin)
      yield* RedRouterPlugin.effect(host)
      expect((yield* waitForCatalog(1)).map((model) => model.id)).toEqual([Model.ID.make("legacy/model")])
      expect(state.requests).toBeGreaterThan(0)
      expect(yield* kv.get(`${cacheKey}:resolved:count`)).toBe(1)
      const pinned = yield* ModelResolver.bind(
        Model.Ref.make({ providerID: Provider.ID.make("red-router"), id: Model.ID.make("legacy/model") }),
      )
      const resolved = yield* resolver.resolve(pinned)
      if (!resolved) return yield* Effect.die("The upgraded catalog did not resolve")
      expect(resolved.ref.connection).toEqual({ type: "credential", id: credential.id })
      expect(resolved.limit.context).toBe(64_000)
      expect((yield* authorization(resolved)).authorization).toBe("Bearer saved-key")
    }),
  ),
)

it.effect("a saved router connection resolves limits the router did not report from the current catalog", () =>
  withEnv({ RED_ROUTER_API_KEY: undefined, RED_ROUTER_BASE_URL: undefined }, () =>
    Effect.gen(function* () {
      const requests = new Set<string>()
      const server = yield* twoAccountRouter(requests)
      const catalog = yield* replaceableCatalog([])
      const credentials = yield* Credential.Service
      const kv = yield* KV.Service
      const models = yield* Model.Service
      const resolver = yield* ModelResolver.Service.pipe(
        Effect.provide(ModelResolver.layer.pipe(Layer.fresh)),
        Effect.provideService(ModelsDev.Service, catalog.service),
      )
      const providerID = Provider.ID.make("red-router")
      const integrationID = Integration.ID.make(providerID)
      const first = yield* credentials.create({
        integrationID,
        value: { type: "key", key: "first-key", configuration: { baseURL: `${server.url.origin}/first/v1` } },
      })
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin)
      yield* RedRouterPlugin.effect(host).pipe(Effect.provideService(ModelsDev.Service, catalog.service))
      yield* advance(() => requests.has("/first/v1/models"))
      const cacheKey = `red-router:models:${Hash.sha256(`${server.url.origin}/first/v1\nfirst-key`)}`
      yield* waitForStoredCatalog(cacheKey, 1)
      const glm = Model.ID.make("zai/glm-5.3-flash")
      const qwen = Model.ID.make("local/qwen")
      // Neither the router nor the catalog describes the model yet: the live catalog carries the guess.
      expect((yield* models.get(providerID, glm))?.limit).toEqual({ context: 115_200, output: 8_192 })
      // The saved catalog keeps only what the router reported and names what it did not.
      expect(yield* kv.get(`${cacheKey}:resolved:format`)).toBe(2)
      expect(
        Schema.decodeUnknownSync(
          Schema.Array(
            Schema.Struct({
              id: Schema.String,
              limit: Schema.Struct({ context: Schema.Number, output: Schema.Number }),
              unreported: Schema.Array(Schema.String),
            }),
          ),
        )(yield* kv.get(`${cacheKey}:resolved:0`)),
      ).toEqual([
        { id: "zai/glm-5.3-flash", limit: { context: 115_200, output: 8_192 }, unreported: ["context", "output"] },
        { id: "local/qwen", limit: { context: 32_000, output: 4_000 }, unreported: [] },
      ])
      const pinned = yield* ModelResolver.bind(Model.Ref.make({ providerID, id: glm }))
      const pinnedQwen = yield* ModelResolver.bind(Model.Ref.make({ providerID, id: qwen }))
      expect(pinned.connection).toEqual({ type: "credential", id: first.id })

      // The catalog learns the model while the router's list stays the same.
      yield* catalog.replace(
        catalogOf(
          { provider: "zai", id: "glm-5.3-flash", context: 1_000_000, output: 131_072 },
          { provider: "local", id: "qwen", context: 1_000_000, output: 131_072 },
        ),
      )
      yield* drain
      expect((yield* models.get(providerID, glm))?.limit).toEqual({ context: 1_000_000, output: 131_072 })

      // Another account becomes active: the saved selection is served from its own connection's catalog.
      yield* credentials.create({
        integrationID,
        value: { type: "key", key: "second-key", configuration: { baseURL: `${server.url.origin}/second/v1` } },
      })
      yield* advance(() => requests.has("/second/v1/models"))
      yield* drain
      expect(yield* models.get(providerID, glm)).toBeUndefined()
      expect((yield* resolver.resolve(pinned))?.limit).toEqual({ context: 1_000_000, output: 131_072 })
      // What the router reported is kept even where the catalog disagrees.
      expect((yield* resolver.resolve(pinnedQwen))?.limit).toEqual({ context: 32_000, output: 4_000 })

      // A later catalog correction reaches the saved selection without the router's list changing.
      yield* catalog.replace(catalogOf({ provider: "zai", id: "glm-5.3-flash", context: 2_000_000, output: 65_536 }))
      yield* drain
      expect((yield* resolver.resolve(pinned))?.limit).toEqual({ context: 2_000_000, output: 65_536 })
      expect((yield* resolver.resolve(pinnedQwen))?.limit).toEqual({ context: 32_000, output: 4_000 })
    }),
  ),
)

it.effect("a saved router catalog written by an older version heals its guessed limits on load", () =>
  Effect.gen(function* () {
    const credentials = yield* Credential.Service
    const kv = yield* KV.Service
    const catalog = yield* replaceableCatalog(
      catalogOf({ provider: "zai", id: "glm-5.3-flash", context: 1_000_000, output: 131_072 }),
    )
    const providerID = Provider.ID.make("red-router")
    const credential = yield* credentials.create({
      integrationID: Integration.ID.make(providerID),
      value: { type: "key", key: "saved-key", configuration: { baseURL: "https://router.invalid/v1" } },
    })
    const cacheKey = `red-router:models:${Hash.sha256("https://router.invalid/v1\nsaved-key")}`
    const stored = (id: string, limit: Model.Info["limit"], unreported?: readonly string[]) =>
      Schema.decodeSync(Schema.fromJsonString(Schema.Json))(
        JSON.stringify({
          ...Model.Info.default(providerID, Model.ID.make(id)),
          package: "@opencode/ai/providers/openai-compatible",
          limit,
          ...(unreported ? { unreported } : {}),
        }),
      )
    yield* kv.set(`${cacheKey}:resolved:count`, 1)
    yield* kv.set(`${cacheKey}:resolved:0`, [
      // Frozen while the catalog did not know the model: the guess and its default output.
      stored("zai/glm-5.3-flash", { context: 115_200, output: 8_192 }),
      // Frozen with an output the router reported next to a guessed context.
      stored("cc/glm-5.3-flash", { context: 115_200, output: 1_000 }),
      // Reported by the router: kept as it was.
      stored("local/qwen", { context: 32_000, output: 4_000 }),
      // Saved with provenance, as the current version writes: the output is capped at the context on load.
      stored("small/model", { context: 4_096, output: 8_192 }, []),
      stored("openrouter/glm-5.3-flash", { context: 115_200, output: 131_072 }, ["context"]),
    ])
    const resolve = (id: string) =>
      connectionModel(
        providerID,
        Model.ID.make(id),
        { type: "credential", id: credential.id, label: credential.label, method: "key" },
        credential.value,
      ).pipe(Effect.provideService(ModelsDev.Service, catalog.service))
    expect((yield* resolve("zai/glm-5.3-flash"))?.limit).toEqual({ context: 1_000_000, output: 131_072 })
    expect((yield* resolve("cc/glm-5.3-flash"))?.limit).toEqual({ context: 1_000_000, output: 1_000 })
    expect((yield* resolve("local/qwen"))?.limit).toEqual({ context: 32_000, output: 4_000 })
    expect((yield* resolve("small/model"))?.limit).toEqual({ context: 4_096, output: 4_096 })
    expect((yield* resolve("openrouter/glm-5.3-flash"))?.limit).toEqual({ context: 1_000_000, output: 131_072 })
  }),
)

it.effect("a configured limit wins for a saved router connection", () =>
  withEnv({ RED_ROUTER_API_KEY: undefined, RED_ROUTER_BASE_URL: undefined }, () =>
    Effect.gen(function* () {
      const requests = new Set<string>()
      const server = yield* twoAccountRouter(requests)
      const catalog = yield* replaceableCatalog(
        catalogOf({ provider: "zai", id: "glm-5.3-flash", context: 1_000_000, output: 131_072 }),
      )
      const credentials = yield* Credential.Service
      const providerID = Provider.ID.make("red-router")
      const integrationID = Integration.ID.make(providerID)
      const configured = Config.testLayer([
        new Document({
          type: "document",
          info: Schema.decodeUnknownSync(Info)({
            providers: {
              "red-router": {
                models: {
                  "zai/glm-5.3-flash": { limit: { context: 300_000 } },
                  "local/qwen": { limit: { context: 200_000, output: 16_000 } },
                },
              },
            },
          }),
        }),
      ])
      const resolver = yield* ModelResolver.Service.pipe(
        Effect.provide(ModelResolver.layer.pipe(Layer.provide(configured), Layer.fresh)),
        Effect.provideService(ModelsDev.Service, catalog.service),
      )
      yield* credentials.create({
        integrationID,
        value: { type: "key", key: "first-key", configuration: { baseURL: `${server.url.origin}/first/v1` } },
      })
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin)
      yield* RedRouterPlugin.effect(host).pipe(Effect.provideService(ModelsDev.Service, catalog.service))
      yield* advance(() => requests.has("/first/v1/models"))
      yield* waitForStoredCatalog(`red-router:models:${Hash.sha256(`${server.url.origin}/first/v1\nfirst-key`)}`, 1)
      const pinned = yield* ModelResolver.bind(Model.Ref.make({ providerID, id: Model.ID.make("zai/glm-5.3-flash") }))
      const pinnedQwen = yield* ModelResolver.bind(Model.Ref.make({ providerID, id: Model.ID.make("local/qwen") }))
      yield* credentials.create({
        integrationID,
        value: { type: "key", key: "second-key", configuration: { baseURL: `${server.url.origin}/second/v1` } },
      })
      yield* advance(() => requests.has("/second/v1/models"))
      yield* drain
      expect((yield* resolver.resolve(pinned))?.limit).toEqual({ context: 300_000, output: 131_072 })
      expect((yield* resolver.resolve(pinnedQwen))?.limit).toEqual({ context: 200_000, output: 16_000 })
    }),
  ),
)
