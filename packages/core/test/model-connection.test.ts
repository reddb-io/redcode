import { expect, test } from "bun:test"
import { LLM } from "@opencode/ai"
import { Credential } from "@opencode/core/credential"
import { Bus } from "@opencode/core/bus"
import { Integration } from "@opencode/core/integration"
import { KV } from "@opencode/core/kv"
import { Model } from "@opencode/core/model"
import { ModelResolver } from "@opencode/core/model-resolver"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { connectionModel, RedRouterPlugin } from "@opencode/core/plugin/provider/red-router"
import { Provider } from "@opencode/core/provider"
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

const waitForCatalog = Effect.fn(function* (count: number) {
  const models = yield* Model.Service
  const observed = { count: 0 }
  yield* models.available().pipe(
    Effect.tap((catalog) =>
      Effect.sync(() => {
        observed.count = catalog.filter((model) => model.providerID === "red-router").length
      }),
    ),
    Effect.repeat(Schedule.spaced("1 millis")),
    Effect.forkScoped,
  )
  yield* advance(() => observed.count === count)
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
