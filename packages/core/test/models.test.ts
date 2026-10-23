import { describe, expect, test } from "bun:test"
import { ModelPresentation } from "@opencode/schema/model-presentation"
import { Money } from "@opencode/schema/money"
import { Effect, Fiber, Layer, Ref, Schema, Scope, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/util/effect/app-node-platform"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { KV } from "@opencode/core/kv"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { Model } from "@opencode/core/model"
import { bodyDigest, ModelsDev } from "@opencode/core/models-dev"
import { Provider } from "@opencode/core/provider"
import { it } from "./lib/effect"
import { tmpdir } from "./fixture/tmpdir"
import { ModelsDevCatalog } from "@opencode/core/models-dev/catalog"
import { location } from "./fixture/location"

const cacheKey = "models-dev:catalog"

const fixture = {
  acme: {
    id: "acme",
    name: "Acme",
    env: ["ACME_API_KEY"],
    models: {
      "acme-1": {
        id: "acme-1",
        name: "Acme One",
        type: "chat",
        release_date: "2026-01-01",
        modalities: { input: ["text"], output: ["text"] },
        capabilities: { tools: { supported: true }, reasoning: { supported: false }, temperature: true },
        limit: { context: 128000, output: 8192 },
        api: {
          "chat-completions": {
            base_url: "https://api.acme.test/v1",
            sdk: { opencodeai: "@opencode/ai/providers/openai-compatible" },
            compatibility: { reasoning_field: "vendor_reasoning" },
          },
        },
      },
    },
  },
}
const fixture2 = {
  beta: {
    id: "beta",
    name: "Beta",
    env: ["BETA_API_KEY"],
    models: {
      "beta-1": {
        id: "beta-1",
        name: "Beta One",
        type: "chat",
        release_date: "2026-02-01",
        modalities: { input: ["text"], output: ["text"] },
        capabilities: { tools: { supported: false }, reasoning: { supported: true }, temperature: false },
        limit: { context: 64000, output: 4096 },
        api: {
          "chat-completions": {
            base_url: "https://api.beta.test/v1",
            sdk: { opencodeai: "@opencode/ai/providers/openai-compatible" },
          },
        },
      },
    },
  },
}
const fixtureSnapshot = [
  {
    info: {
      id: Provider.ID.make("acme"),
      name: "Acme",
      activation: "auto",
      package: "@opencode/ai/providers/openai-compatible",
    },
    models: [
      {
        id: Model.ID.make("acme-1"),
        modelID: Model.ID.make("acme-1"),
        providerID: Provider.ID.make("acme"),
        name: "Acme One",
        compatibility: { reasoningField: "vendor_reasoning" },
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: "https://api.acme.test/v1" },
        capabilities: { tools: true, reasoning: false, temperature: true, input: ["text"], output: ["text"] },
        variants: [],
        time: { released: Date.parse("2026-01-01") },
        cost: [],
        catalog: {
          format: 2,
          digest: bodyDigest(JSON.stringify(fixture)),
          protocol: "chat-completions",
          apis: {
            "chat-completions": {
              baseURL: "https://api.acme.test/v1",
              sdk: { opencodeai: "@opencode/ai/providers/openai-compatible" },
              capabilities: fixture.acme.models["acme-1"].capabilities,
              compatibility: { reasoning_field: "vendor_reasoning" },
            },
          },
          rates: [],
          modalities: { input: ["text"], output: ["text"] },
        },
        status: "active",
        enabled: true,
        limit: { context: 128000, output: 8192 },
      },
    ],
    environment: ["ACME_API_KEY"],
  },
] satisfies readonly ModelsDev.Snapshot[]
const fixture2Snapshot = [
  {
    info: {
      id: Provider.ID.make("beta"),
      name: "Beta",
      activation: "auto",
      package: "@opencode/ai/providers/openai-compatible",
    },
    models: [
      {
        id: Model.ID.make("beta-1"),
        modelID: Model.ID.make("beta-1"),
        providerID: Provider.ID.make("beta"),
        name: "Beta One",
        compatibility: {},
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: "https://api.beta.test/v1" },
        capabilities: { tools: false, reasoning: true, temperature: false, input: ["text"], output: ["text"] },
        variants: [],
        time: { released: Date.parse("2026-02-01") },
        cost: [],
        catalog: {
          format: 2,
          digest: bodyDigest(JSON.stringify(fixture2)),
          protocol: "chat-completions",
          apis: {
            "chat-completions": {
              baseURL: "https://api.beta.test/v1",
              sdk: { opencodeai: "@opencode/ai/providers/openai-compatible" },
              capabilities: fixture2.beta.models["beta-1"].capabilities,
            },
          },
          rates: [],
          modalities: { input: ["text"], output: ["text"] },
        },
        status: "active",
        enabled: true,
        limit: { context: 64000, output: 4096 },
      },
    ],
    environment: ["BETA_API_KEY"],
  },
] satisfies readonly ModelsDev.Snapshot[]

interface MockState {
  body: string
  status: number
  calls: Array<{ url: string; userAgent: string | null }>
}

const makeMockClient = (state: Ref.Ref<MockState>) =>
  HttpClient.make((request) =>
    Effect.gen(function* () {
      yield* Ref.update(state, (s) => ({
        ...s,
        calls: [...s.calls, { url: request.url, userAgent: request.headers["user-agent"] ?? null }],
      }))
      const s = yield* Ref.get(state)
      return HttpClientResponse.fromWeb(request, new Response(s.body, { status: s.status }))
    }),
  )

interface MockCache {
  readonly values: Map<string, KV.Value>
}

const makeMockKV = (cache: MockCache) =>
  Layer.mock(KV.Service, {
    get: (key) => Effect.sync(() => cache.values.get(key)),
    set: (key, value) => Effect.sync(() => cache.values.set(key, value)).pipe(Effect.asVoid),
    remove: (key) => Effect.sync(() => cache.values.delete(key)).pipe(Effect.asVoid),
  })

const buildLayer = (state: Ref.Ref<MockState>, cache: MockCache, options: ModelsDev.Options = { fetch: false }) =>
  // Layer.fresh is required because the ModelsDev implementation is a module-level Layer constant,
  // and Effect.provide uses a process-global MemoMap by default — without fresh,
  // every test would reuse the cachedInvalidateWithTTL state from the first run.
  Layer.fresh(
    AppNodeBuilder.build(LayerNode.group([ModelsDev.node, Bus.node]), [
      ModelsDev.node.replace(ModelsDev.configured(options)),
      LayerNodePlatform.httpClient.replace(Layer.succeed(HttpClient.HttpClient, makeMockClient(state))),
      KV.node.replace(makeMockKV(cache)),
    ]),
  )

// Mirrors production KV backends whose writes die as defects (e.g. Durable
// Object SQLite rejecting values over its 2 MB cap with EffectDrizzleQueryError).
const makeFailingWriteKV = (cache: MockCache) =>
  Layer.mock(KV.Service, {
    get: (key) => Effect.sync(() => cache.values.get(key)),
    set: () => Effect.die(new Error('Failed query: insert into "kv"')),
    remove: (key) => Effect.sync(() => cache.values.delete(key)).pipe(Effect.asVoid),
  })

const makeCache = (): MockCache => ({ values: new Map() })

const writeCacheText = (cache: MockCache, text: string, updatedAt = Date.now()) =>
  cache.values.set(cacheKey, { updatedAt, digest: bodyDigest(text), body: text })

const writeCache = (cache: MockCache, data: object, updatedAt?: number) =>
  writeCacheText(cache, JSON.stringify(data), updatedAt)

const provided = <A, E>(
  state: Ref.Ref<MockState>,
  cache: MockCache,
  eff: Effect.Effect<A, E, ModelsDev.Service | Bus.Service | Scope.Scope>,
) => eff.pipe(Effect.provide(buildLayer(state, cache)))

const initialState: MockState = {
  body: JSON.stringify(fixture),
  status: 200,
  calls: [],
}

const unsupported = { obsolete: { id: "obsolete", name: "Obsolete", env: [], npm: "@ai-sdk/openai", models: {} } }

test("rejects V1 and mixed catalog documents, including providers without models", () => {
  expect(() => Schema.decodeUnknownSync(ModelsDevCatalog.Document)(unsupported)).toThrow("Only models.dev V2")
  expect(() => Schema.decodeUnknownSync(ModelsDevCatalog.Document)({ ...fixture, ...unsupported })).toThrow(
    "Only models.dev V2",
  )
})

test("an explicitly configured non-V2 file fails instead of silently using the bundled catalog", async () => {
  await using dir = await tmpdir()
  const file = `${dir.path}/catalog.json`
  await Bun.write(file, JSON.stringify(unsupported))
  const state = await Effect.runPromise(Ref.make(initialState))
  await expect(
    Effect.runPromise(
      ModelsDev.Service.use((service) => service.get()).pipe(
        Effect.provide(buildLayer(state, makeCache(), { file, fetch: false })),
      ),
    ),
  ).rejects.toThrow("Only models.dev V2")
})

describe("ModelsDev Service", () => {
  it.live("discards a fresh V1 cache and loads only the bundled V2 catalog", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, unsupported)
      const state = yield* Ref.make(initialState)
      const result = yield* provided(
        state,
        cache,
        ModelsDev.Service.use((service) => service.get()),
      )
      expect(result.length).toBeGreaterThan(100)
      expect(result.flatMap((provider) => provider.models).every((model) => model.catalog?.format === 2)).toBe(true)
      expect(cache.values.has(cacheKey)).toBe(false)
      expect((yield* Ref.get(state)).calls).toEqual([])
    }),
  )

  it.live("rejects a V1 HTTP response without caching it or trying a V1 public fallback", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(unsupported) })
      const result = yield* ModelsDev.Service.use((service) => service.get()).pipe(
        Effect.provide(buildLayer(state, cache, { fetch: true, snapshot: false })),
      )
      expect(result).toEqual([])
      expect(cache.values.has(cacheKey)).toBe(false)
      expect((yield* Ref.get(state)).calls.map((call) => call.url)).toEqual([...ModelsDev.DEFAULT_SOURCES])
    }),
  )

  it.live("retains decision roles and canonical identity without changing executable aliases", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, {
        acme: {
          ...fixture.acme,
          models: {
            alias: {
              ...fixture.acme.models["acme-1"],
              id: "alias",
              type: "decision",
              canonical_id: "typesafe/jev-latest",
            },
          },
        },
      })
      const state = yield* Ref.make(initialState)
      const result = yield* provided(
        state,
        cache,
        ModelsDev.Service.use((service) => service.get()),
      )
      expect(result[0].models[0]).toMatchObject({
        id: "alias",
        type: "decision",
        canonicalModelID: "typesafe/jev-latest",
      })
    }),
  )

  it.live("get() returns normalized snapshots from KV when a cache entry exists", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, fixture)
      const state = yield* Ref.make(initialState)
      const result = yield* provided(
        state,
        cache,
        ModelsDev.Service.use((s) => s.get()),
      )
      expect(result).toEqual(fixtureSnapshot)
      const final = yield* Ref.get(state)
      expect(final.calls).toEqual([])
    }),
  )

  it.live("get() returns empty catalog when KV is empty, fetch disabled, and the bundled snapshot is disabled", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      const state = yield* Ref.make(initialState)
      const result = yield* ModelsDev.Service.use((s) => s.get()).pipe(
        Effect.provide(buildLayer(state, cache, { fetch: false, snapshot: false })),
      )
      expect(result).toEqual([])
      const final = yield* Ref.get(state)
      expect(final.calls).toEqual([])
    }),
  )

  it.live("get() falls back to the bundled snapshot when KV is empty and fetch is disabled", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      const state = yield* Ref.make(initialState)
      const result = yield* provided(
        state,
        cache,
        ModelsDev.Service.use((s) => s.get()),
      )
      expect(result.length).toBeGreaterThan(0)
      const anthropic = result.find((snapshot) => snapshot.info.id === "anthropic")
      expect(anthropic?.environment).toContain("ANTHROPIC_API_KEY")
      const final = yield* Ref.get(state)
      expect(final.calls).toEqual([])
    }),
  )

  it.live("get() recovers from a corrupted KV entry by fetching a fresh catalog", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCacheText(cache, "{")
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      const context = yield* Layer.build(buildLayer(state, cache, { fetch: true, snapshot: false }))
      const result = yield* ModelsDev.Service.use((s) => s.get()).pipe(Effect.provide(context))
      expect(result).toEqual(fixture2Snapshot)
      expect(cache.values.get(cacheKey)).toMatchObject({
        body: JSON.stringify(fixture2),
        digest: bodyDigest(JSON.stringify(fixture2)),
      })
      const final = yield* Ref.get(state)
      expect(final.calls.length).toBe(1)
    }),
  )

  it.live("get() still populates the catalog when the KV cache write fails", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      const layer = Layer.fresh(
        AppNodeBuilder.build(ModelsDev.node, [
          ModelsDev.node.replace(ModelsDev.configured({ fetch: true, snapshot: false })),
          LayerNodePlatform.httpClient.replace(Layer.succeed(HttpClient.HttpClient, makeMockClient(state))),
          KV.node.replace(makeFailingWriteKV(cache)),
        ]),
      )
      const result = yield* ModelsDev.Service.use((s) => s.get()).pipe(Effect.provide(layer))
      expect(result).toEqual(fixture2Snapshot)
      expect(cache.values.has(cacheKey)).toBe(false)
      const final = yield* Ref.get(state)
      expect(final.calls.length).toBe(1)
    }),
  )

  it.live("uses the default models URL when the configured URL is empty", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      const state = yield* Ref.make(initialState)
      yield* ModelsDev.Service.use((service) => service.get()).pipe(
        Effect.provide(buildLayer(state, cache, { url: "", fetch: true, snapshot: false })),
      )
      expect((yield* Ref.get(state)).calls[0]?.url).toBe("https://models.dev/experimental/v2.0/api.json")
    }),
  )

  it.live("get() is single-flight under concurrent calls", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      const state = yield* Ref.make(initialState)
      const results = yield* Effect.gen(function* () {
        const svc = yield* ModelsDev.Service
        return yield* Effect.all([svc.get(), svc.get(), svc.get(), svc.get(), svc.get()], {
          concurrency: "unbounded",
        })
      }).pipe(Effect.provide(buildLayer(state, cache, { fetch: true, snapshot: false })))
      for (const result of results) expect(result).toEqual(fixtureSnapshot)
      expect((yield* Ref.get(state)).calls.length).toBe(1)
    }),
  )

  it.live("get() caches across calls (later KV writes are ignored until invalidate)", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, fixture)
      const state = yield* Ref.make(initialState)
      const first = yield* provided(
        state,
        cache,
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          const a = yield* svc.get()
          writeCache(cache, fixture2)
          const b = yield* svc.get()
          return { a, b }
        }),
      )
      expect(first.a).toEqual(fixtureSnapshot)
      expect(first.b).toEqual(fixtureSnapshot)
    }),
  )

  it.live("refresh(true) fetches via HttpClient and updates the cache", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, fixture)
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      const result = yield* provided(
        state,
        cache,
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          const before = yield* svc.get()
          yield* svc.refresh(true)
          const after = yield* svc.get()
          return { before, after }
        }),
      )
      expect(result.before).toEqual(fixtureSnapshot)
      expect(result.after).toEqual(fixture2Snapshot)
      expect(cache.values.get(cacheKey)).toMatchObject({
        body: JSON.stringify(fixture2),
        digest: bodyDigest(JSON.stringify(fixture2)),
      })
      const final = yield* Ref.get(state)
      expect(final.calls.length).toBe(1)
      expect(final.calls[0].url).toContain("/api.json")
      expect(final.calls[0].userAgent).toContain("/opencode")
    }),
  )

  it.live("refresh(false) skips fetch when the KV entry is fresh", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, fixture, Date.now() - 1000)
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      yield* provided(
        state,
        cache,
        ModelsDev.Service.use((s) => s.refresh(false)),
      )
      const final = yield* Ref.get(state)
      expect(final.calls).toEqual([])
    }),
  )

  it.live("refresh(false) fetches when the KV entry is stale", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, fixture, Date.now() - 10 * 60 * 1000)
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      const after = yield* provided(
        state,
        cache,
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          const bus = yield* Bus.Service
          const refreshed = yield* bus.subscribe(ModelsDev.Event.Refreshed).pipe(
            Stream.take(1),
            Stream.runCollect,
            Effect.forkScoped,
            Effect.flatMap((fiber) =>
              Effect.gen(function* () {
                yield* Effect.yieldNow
                yield* svc.refresh(false)
                return yield* Fiber.join(fiber)
              }),
            ),
          )
          expect(refreshed.length).toBe(1)
          return yield* svc.get()
        }),
      )
      const final = yield* Ref.get(state)
      expect(final.calls.length).toBe(1)
      expect(after).toEqual(fixture2Snapshot)
      expect(cache.values.get(cacheKey)).toMatchObject({
        body: JSON.stringify(fixture2),
        digest: bodyDigest(JSON.stringify(fixture2)),
      })
    }),
  )

  it.live("refresh reaches model catalogs in other Locations", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, fixture, Date.now() - 10 * 60 * 1000)
      const state = yield* Ref.make({ ...initialState, body: JSON.stringify(fixture2) })
      yield* provided(
        state,
        cache,
        Effect.gen(function* () {
          const service = yield* ModelsDev.Service
          const bus = yield* Bus.Service
          const observed = yield* bus
            .subscribe(ModelsDev.Event.Refreshed)
            .pipe(
              Stream.take(1),
              Stream.runCollect,
              Effect.provideService(
                Location.Service,
                Location.Service.of(location({ directory: AbsolutePath.make("/other") })),
              ),
              Effect.forkScoped({ startImmediately: true }),
            )
          yield* service
            .refresh(true)
            .pipe(
              Effect.provideService(
                Location.Service,
                Location.Service.of(location({ directory: AbsolutePath.make("/first") })),
              ),
            )
          const events = yield* Fiber.join(observed).pipe(Effect.timeout("1 second"))
          expect(events).toHaveLength(1)
          expect(events[0]?.location).toBeUndefined()
        }),
      )
    }),
  )

  it.live("refresh(false) stays quiet when the fetched body matches the cached digest", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, fixture, Date.now() - 10 * 60 * 1000)
      const seeded = structuredClone(cache.values.get(cacheKey))
      // The server serves a byte-identical body, so the refresh still hits
      // the network but must not rewrite the cache or publish Refreshed.
      const state = yield* Ref.make(initialState)
      yield* provided(
        state,
        cache,
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          const bus = yield* Bus.Service
          const event = yield* bus.subscribe(ModelsDev.Event.Refreshed).pipe(
            Stream.take(1),
            Stream.runCollect,
            Effect.forkScoped,
            Effect.flatMap((fiber) =>
              Effect.gen(function* () {
                yield* Effect.yieldNow
                yield* svc.refresh(false)
                return yield* Fiber.join(fiber).pipe(Effect.timeoutOption("50 millis"))
              }),
            ),
          )
          expect(event._tag).toBe("None")
        }),
      )
      const final = yield* Ref.get(state)
      expect(final.calls.length).toBe(1)
      expect(cache.values.get(cacheKey)).toEqual(seeded)
    }),
  )

  it.live("refresh(false) republishes once for legacy cache entries without a digest", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      cache.values.set(cacheKey, { updatedAt: Date.now() - 10 * 60 * 1000, body: JSON.stringify(fixture) })
      const state = yield* Ref.make(initialState)
      yield* provided(
        state,
        cache,
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          const bus = yield* Bus.Service
          const refreshed = yield* bus.subscribe(ModelsDev.Event.Refreshed).pipe(
            Stream.take(1),
            Stream.runCollect,
            Effect.forkScoped,
            Effect.flatMap((fiber) =>
              Effect.gen(function* () {
                yield* Effect.yieldNow
                yield* svc.refresh(false)
                return yield* Fiber.join(fiber)
              }),
            ),
          )
          expect(refreshed.length).toBe(1)
        }),
      )
      // The rewritten entry now carries a digest, so later identical bodies stay quiet.
      expect(cache.values.get(cacheKey)).toMatchObject({ digest: bodyDigest(JSON.stringify(fixture)) })
    }),
  )

  it.live("refresh swallows HTTP errors and leaves cache intact", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, fixture)
      const state = yield* Ref.make({ ...initialState, status: 500, body: "boom" })
      const result = yield* provided(
        state,
        cache,
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          yield* svc.refresh(true)
          return yield* svc.get()
        }),
      )
      expect(result).toEqual(fixtureSnapshot)
      // retryTransient retries 5xx, so calls may be > 1.
      const final = yield* Ref.get(state)
      expect(final.calls.length).toBeGreaterThanOrEqual(1)
    }),
  )
})

describe("ModelsDev catalog sources", () => {
  test("orders REDCODE_MODELS_URL, configured sources and the public catalogs without duplicates", () => {
    expect(
      ModelsDev.sources(["https://mirror.example", " ", undefined, "https://mirror.example/", "not a url"]),
    ).toEqual(["https://mirror.example/api.json", ...ModelsDev.DEFAULT_SOURCES])
    expect(ModelsDev.sources(["https://cdn.example/catalog.json", "https://models.dev"])).toEqual([
      "https://cdn.example/catalog.json",
      "https://models.dev/experimental/v2.0/api.json",
    ])
  })

  test("backs a blocked source off for 1h, then 6h, then 24h", () => {
    const hour = 3_600_000
    expect([1, 2, 3, 9].map(ModelsDev.backoff)).toEqual([hour, 6 * hour, 24 * hour, 24 * hour])
  })

  test("recognizes proxy and TLS failures without reading stack frames", () => {
    expect(ModelsDev.classifyError(new Error("unable to verify the first certificate")).blocked).toBe(true)
    expect(
      ModelsDev.classifyError({ message: "connect failed", cause: { code: "ERR_TLS_CERT_ALTNAME_INVALID" } }).blocked,
    ).toBe(true)
    const reset = Object.assign(new Error("socket hang up"), { stack: "at tls-socket.js:1" })
    expect(ModelsDev.classifyError(reset)).toEqual({ blocked: false, reason: "socket hang up" })
  })

  test("reads persisted backoff defensively and caps it at 24 hours", () => {
    const now = 1_000
    expect(ModelsDev.decodeState(undefined, now)).toEqual({ sources: {} })
    expect(ModelsDev.decodeState("{", now)).toEqual({ sources: {} })
    expect(
      ModelsDev.decodeState(
        JSON.stringify({
          source: "a",
          sources: { b: { failures: 2, blockedUntil: now + 99 * 3_600_000, reason: "HTTP 403" } },
        }),
        now,
      ),
    ).toEqual({ source: "a", sources: { b: { failures: 2, blockedUntil: now + 24 * 3_600_000, reason: "HTTP 403" } } })
  })

  it.live("skips a blocked source, uses the next one and remembers the block", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      const calls: string[] = []
      const client = HttpClient.make((request) =>
        Effect.sync(() => {
          calls.push(request.url)
          const blocked = request.url.startsWith("https://blocked.example")
          return HttpClientResponse.fromWeb(
            request,
            new Response(blocked ? "<html>denied</html>" : JSON.stringify(fixture2), { status: blocked ? 403 : 200 }),
          )
        }),
      )
      const layer = Layer.fresh(
        AppNodeBuilder.build(LayerNode.group([ModelsDev.node, Bus.node]), [
          ModelsDev.node.replace(
            ModelsDev.configured({ url: "https://blocked.example", fetch: true, snapshot: false }),
          ),
          LayerNodePlatform.httpClient.replace(Layer.succeed(HttpClient.HttpClient, client)),
          KV.node.replace(makeMockKV(cache)),
        ]),
      )
      const result = yield* ModelsDev.Service.use((service) => service.get()).pipe(Effect.provide(layer))
      expect(result).toEqual(fixture2Snapshot)
      expect(calls).toEqual(["https://blocked.example/api.json", "https://models.dev/experimental/v2.0/api.json"])
      const state = ModelsDev.decodeState(cache.values.get("models-dev:sources"))
      expect(state.source).toBe("https://models.dev/experimental/v2.0/api.json")
      expect(state.sources["https://blocked.example/api.json"]).toMatchObject({ failures: 1, reason: "HTTP 403" })
    }),
  )

  it.live("a page that is not a catalog never replaces the cache", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCache(cache, fixture, Date.now() - 10 * 60 * 1000)
      const seeded = structuredClone(cache.values.get(cacheKey))
      const state = yield* Ref.make({ ...initialState, body: "<html>captive portal</html>" })
      const result = yield* provided(
        state,
        cache,
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          yield* svc.refresh(true)
          return yield* svc.get()
        }),
      )
      expect(result).toEqual(fixtureSnapshot)
      expect(cache.values.get(cacheKey)).toEqual(seeded)
    }),
  )
})

const v2Offering = {
  id: "published/route",
  canonical_id: "lab/canonical",
  type: "chat",
  name: "V2 model",
  release_date: "2026-10-23",
  modalities: { input: ["text", "image/png", "image/jpeg", "application/pdf"], output: ["text"] },
  capabilities: {
    tools: { supported: true, updates: true },
    reasoning: { supported: true, effort: ["low", "high"] },
    temperature: false,
    system_updates: true,
    effort_updates: false,
  },
  limit: { context: 128000, output: 8192 },
  api: {
    responses: {
      base_url: "https://api.acme.test/v2",
      sdk: { opencodeai: "@opencode/ai/providers/openai/responses" },
      capabilities: {
        tools: { supported: false },
        reasoning: { supported: false },
        temperature: true,
        system_updates: false,
        effort_updates: true,
      },
      compatibility: {
        reasoning_field: "vendor_reasoning",
        max_tokens_field: "max_completion_tokens",
        replay_reasoning: true,
      },
    },
    "chat-completions": {
      base_url: "https://api.acme.test/chat",
      sdk: { opencodeai: "@opencode/ai/providers/openai/chat" },
    },
    future: { base_url: "https://future.acme.test", sdk: { opencodeai: "unregistered-package" } },
  },
  cost: {
    text: {
      input: { price: 2, cache: { read: 0.2, write: { "5m": 2.5, "1h": 4 } } },
      output: { price: 4, overrides: [{ when: { context: { gt: 200000 } }, price: 8 }] },
    },
    image: { output: { price: 0.04, unit: "image" } },
    audio: { input: { price: 0.006, unit: "minute" } },
    web_search: { price: 10 },
  },
}
const v2 = (model: unknown = v2Offering) => ({
  acme: { id: "acme", name: "Acme", env: ["ACME_API_KEY"], models: { model } },
})

describe("ModelsDev V2", () => {
  it.live(
    "imports protocol declarations, selected capabilities, MIME types and rich prices without changing route identity",
    () =>
      Effect.gen(function* () {
        const text = JSON.stringify(v2())
        const cache = makeCache()
        writeCacheText(cache, text)
        const state = yield* Ref.make<MockState>({ body: text, status: 200, calls: [] })
        const snapshots = yield* Effect.gen(function* () {
          const catalog = yield* ModelsDev.Service
          return yield* catalog.get()
        }).pipe(Effect.provide(buildLayer(state, cache)))
        const model = snapshots[0]!.models[0]!
        expect(model).toMatchObject({
          id: "published/route",
          modelID: "published/route",
          canonicalModelID: "lab/canonical",
          package: "@opencode/ai/providers/openai/responses",
          settings: { baseURL: "https://api.acme.test/v2" },
          capabilities: {
            tools: false,
            reasoning: false,
            temperature: true,
            input: ["text", "image", "pdf"],
            output: ["text"],
          },
          compatibility: {
            reasoningField: "vendor_reasoning",
            maxTokensField: "max_completion_tokens",
          },
          variants: [],
          cost: [],
          catalog: { format: 2, digest: bodyDigest(text), protocol: "responses" },
        })
        expect(model.compatibility?.supportsEffortUpdates).toBeUndefined()
        expect(model.compatibility?.requireReasoning).toBeUndefined()
        expect(model.catalog?.apis.responses?.compatibility?.replay_reasoning).toBe(true)
        expect(model.catalog?.apis.responses?.capabilities.tools).toEqual({ supported: false })
        expect(model.catalog?.apis.responses?.capabilities.reasoning).toEqual({ supported: false })
        expect(model.catalog?.apis.responses?.capabilities.system_updates).toBe(false)
        expect(model.catalog?.apis["chat-completions"]?.capabilities.system_updates).toBe(true)
        expect(model.catalog?.apis.future?.sdk?.opencodeai).toBe("unregistered-package")
        expect(model.catalog?.modalities?.input).toEqual(v2Offering.modalities.input)
        expect(model.catalog?.pricing).toEqual(v2Offering.cost)
        expect(model.catalog?.rates).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ modality: "text", unit: "token", per: 1000000, price: 2 }),
            expect.objectContaining({ modality: "image", unit: "image", per: 1, price: 0.04 }),
            expect.objectContaining({ modality: "audio", unit: "minute", per: 1, price: 0.006 }),
            expect.objectContaining({ modality: "web_search", unit: "search", per: 1000, price: 10 }),
          ]),
        )
        expect(Schema.decodeUnknownSync(Model.Info)(Schema.encodeSync(Model.Info)(model))).toEqual(model)
        expect(ModelPresentation.free(model)).toBe(false)
      }),
  )

  it.live("refreshes V2 and preserves the good cache after a structurally invalid JSON response", () =>
    Effect.gen(function* () {
      const cache = makeCache()
      writeCacheText(cache, JSON.stringify(fixture), 0)
      const state = yield* Ref.make<MockState>({ body: JSON.stringify(v2()), status: 200, calls: [] })
      yield* Effect.gen(function* () {
        const catalog = yield* ModelsDev.Service
        expect((yield* catalog.get())[0]!.models[0]!.catalog?.format).toBe(2)
        yield* catalog.refresh(true)
        expect((yield* catalog.get())[0]!.models[0]!.catalog?.format).toBe(2)
        const saved = cache.values.get(cacheKey)
        yield* Effect.forEach(
          [
            { not_a_provider: { models: {} } },
            unsupported,
            { ...v2(), ...unsupported },
            v2({ ...v2Offering, cost: { text: { input: { price: -1 } } } }),
            v2({
              ...v2Offering,
              api: {
                responses: {
                  ...v2Offering.api.responses,
                  capabilities: { tools: { supported: true, updates: "invalid" } },
                },
              },
            }),
          ],
          (body) =>
            Effect.gen(function* () {
              yield* Ref.update(state, (value) => ({ ...value, body: JSON.stringify(body) }))
              yield* catalog.refresh(true)
              expect(cache.values.get(cacheKey)).toEqual(saved)
              expect((yield* catalog.get())[0]!.models[0]!.catalog?.format).toBe(2)
            }),
        )
      }).pipe(Effect.provide(buildLayer(state, cache)))
    }),
  )

  it.live("never turns a remote SDK name or a specialized API into an executable chat route", () =>
    Effect.gen(function* () {
      const entry = {
        ...v2Offering,
        api: { responses: { base_url: "https://api.acme.test", sdk: { opencodeai: "unregistered-package" } } },
      }
      const text = JSON.stringify(v2(entry))
      const cache = makeCache()
      writeCacheText(cache, text)
      const state = yield* Ref.make<MockState>({ body: text, status: 200, calls: [] })
      const model = yield* Effect.gen(function* () {
        const catalog = yield* ModelsDev.Service
        return (yield* catalog.get())[0]!.models[0]!
      }).pipe(Effect.provide(buildLayer(state, cache)))
      expect(model.enabled).toBe(false)
      expect(model.type).toBe("chat")
      expect(model.package).toBeUndefined()
      expect(model.catalog?.protocol).toBeUndefined()
      expect(model.catalog?.apis.responses?.sdk?.opencodeai).toBe("unregistered-package")
    }),
  )

  it.live("keeps known zero, missing prices, paid output and non-token units distinct", () =>
    Effect.gen(function* () {
      const entries = [
        { ...v2Offering, id: "free", cost: { text: { input: { price: 0 }, output: { price: 0 } } } },
        { ...v2Offering, id: "paid-output", cost: { text: { input: { price: 0 }, output: { price: 1 } } } },
        { ...v2Offering, id: "unknown", cost: undefined },
        {
          ...v2Offering,
          id: "characters",
          cost: { text: { input: { price: 1, unit: "character" }, output: { price: 1, unit: "character" } } },
        },
      ]
      const text = JSON.stringify({
        acme: { ...v2().acme, models: Object.fromEntries(entries.map((entry) => [entry.id, entry])) },
      })
      const cache = makeCache()
      writeCacheText(cache, text)
      const state = yield* Ref.make<MockState>({ body: text, status: 200, calls: [] })
      const models = yield* Effect.gen(function* () {
        const catalog = yield* ModelsDev.Service
        return (yield* catalog.get())[0]!.models
      }).pipe(Effect.provide(buildLayer(state, cache)))
      expect(models.map(ModelPresentation.free)).toEqual([true, false, false, false])
      expect(models[2]!.cost).toEqual([])
      expect(models[3]!.catalog?.rates[0]).toMatchObject({ unit: "character", per: 1000000, price: 1 })
      expect(models[3]!.cost).toEqual([])
    }),
  )
})
