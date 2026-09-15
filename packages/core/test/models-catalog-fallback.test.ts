import { describe, expect, beforeAll, beforeEach, afterAll } from "bun:test"
import { Effect, Layer, Logger } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { LayerNodePlatform } from "@reddb-io/redcode-core/effect/app-node-platform"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { Flag } from "@reddb-io/redcode-core/flag/flag"
import { Global } from "@reddb-io/redcode-core/global"
import { ModelsDev } from "@reddb-io/redcode-core/models-dev"
import { EventV2 } from "@reddb-io/redcode-core/event"
import { it } from "./lib/effect"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises"
import os from "os"
import path from "path"

// Every request goes to a local fake server: the two public hosts are rewritten to routes on it,
// and any other host is rewritten to a route that answers 599, so nothing can reach the internet.
type Route = { status: number; body: string; type?: string }
const routes = new Map<string, Route>()
const hits = new Map<string, number>()
let server: ReturnType<typeof Bun.serve>
let base = ""

const catalog = (id: string): Record<string, ModelsDev.Provider> => ({
  [id]: {
    id,
    name: id,
    env: [],
    models: {
      [`${id}-1`]: {
        id: `${id}-1`,
        name: `${id} One`,
        release_date: "2026-01-01",
        attachment: false,
        reasoning: false,
        temperature: true,
        tool_call: true,
        limit: { context: 128000, output: 8192 },
      },
    },
  },
})

const OPENCODE = "/opencode/api.json"
const MODELSDEV = "/modelsdev/api.json"
const MIRROR = "/mirror/api.json"
const blocked: Route = { status: 403, body: "Forbidden by corporate policy" }
const ok = (id: string): Route => ({ status: 200, body: JSON.stringify(catalog(id)), type: "application/json" })

const cacheFile = path.join(Global.Path.cache, "models.json")
const stateFile = path.join(Global.Path.cache, "models-state.json")
const ORIGINAL = {
  path: Flag.REDCODE_MODELS_PATH,
  disable: Flag.REDCODE_DISABLE_MODELS_FETCH,
  url: Flag.REDCODE_MODELS_URL,
  configDir: process.env.REDCODE_CONFIG_DIR,
}
let configDir = ""

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const pathname = new URL(request.url).pathname
      hits.set(pathname, (hits.get(pathname) ?? 0) + 1)
      const route = routes.get(pathname)
      if (!route) return new Response("unexpected", { status: 599 })
      return new Response(route.body, { status: route.status, headers: { "content-type": route.type ?? "text/plain" } })
    },
  })
  base = `http://127.0.0.1:${server.port}`
  configDir = await mkdtemp(path.join(os.tmpdir(), "redcode-models-config-"))
  process.env.REDCODE_CONFIG_DIR = configDir
  Flag.REDCODE_MODELS_PATH = undefined
  Flag.REDCODE_MODELS_URL = undefined
  // Keeps the layer from forking its startup refresh; tests drive refresh() themselves.
  Flag.REDCODE_DISABLE_MODELS_FETCH = true
})

afterAll(async () => {
  server.stop(true)
  Flag.REDCODE_MODELS_PATH = ORIGINAL.path
  Flag.REDCODE_DISABLE_MODELS_FETCH = ORIGINAL.disable
  Flag.REDCODE_MODELS_URL = ORIGINAL.url
  if (ORIGINAL.configDir === undefined) delete process.env.REDCODE_CONFIG_DIR
  else process.env.REDCODE_CONFIG_DIR = ORIGINAL.configDir
  delete (globalThis as Record<string, unknown>).REDCODE_MODELS_DEV
  await rm(configDir, { recursive: true, force: true })
  await rm(cacheFile, { force: true })
  await rm(stateFile, { force: true })
})

beforeEach(async () => {
  routes.clear()
  hits.clear()
  delete (globalThis as Record<string, unknown>).REDCODE_MODELS_DEV
  await rm(path.join(configDir, "redcode.json"), { force: true })
  await rm(cacheFile, { force: true })
  await rm(stateFile, { force: true })
})

const localClient = Layer.effect(
  HttpClient.HttpClient,
  Effect.map(HttpClient.HttpClient, (client) =>
    HttpClient.mapRequest(
      client,
      HttpClientRequest.updateUrl((url) => {
        if (url.startsWith(base)) return url
        if (url.startsWith("https://models.opencode.ai/")) return `${base}/opencode/${url.split("/").pop()}`
        if (url.startsWith("https://models.dev/")) return `${base}/modelsdev/${url.split("/").pop()}`
        return `${base}/unexpected`
      }),
    ),
  ),
).pipe(Layer.provide(FetchHttpClient.layer))

interface LogLine {
  level: string
  message: string
}

const run = <A, E>(effect: Effect.Effect<A, E, ModelsDev.Service | EventV2.Service>, logs: LogLine[] = []) =>
  effect.pipe(
    Effect.provide(
      Layer.fresh(
        AppNodeBuilder.build(LayerNode.group([ModelsDev.node, EventV2.node]), [
          [LayerNodePlatform.httpClient, localClient],
        ]),
      ),
    ),
    Effect.provide(
      Logger.layer(
        [
          Logger.make((options) => {
            const message = Array.isArray(options.message) ? options.message.join(" ") : String(options.message)
            logs.push({ level: String(options.logLevel), message })
          }),
        ],
        { mergeWithExisting: false },
      ),
    ),
  )

const readState = () => Effect.promise(async () => JSON.parse(await readFile(stateFile, "utf8")))

describe("ModelsDev source chain", () => {
  it.live("falls through a 403 on the first source to the second", () =>
    Effect.gen(function* () {
      routes.set(OPENCODE, blocked)
      routes.set(MODELSDEV, ok("upstream"))
      const result = yield* run(
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          yield* svc.refresh(true)
          return { providers: yield* svc.get(), status: yield* svc.status() }
        }),
      )
      expect(result.providers).toEqual(catalog("upstream"))
      expect(result.status.origin).toBe("cache")
      expect(result.status.source).toBe("https://models.dev/api.json")
      // 403 is not transient: one request, no retries.
      expect(hits.get(OPENCODE)).toBe(1)
      const state = yield* readState()
      expect(state.sources["https://models.opencode.ai/api.json"].failures).toBe(1)
      expect(state.sources["https://models.opencode.ai/api.json"].blockedUntil).toBeGreaterThan(
        Date.now() + 50 * 60_000,
      )
    }),
  )

  it.live("serves the bundled snapshot when every source is blocked", () =>
    Effect.gen(function* () {
      ;(globalThis as Record<string, unknown>).REDCODE_MODELS_DEV = catalog("bundled")
      routes.set(OPENCODE, blocked)
      routes.set(MODELSDEV, { status: 407, body: "Proxy Authentication Required" })
      const result = yield* run(
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          yield* svc.refresh(true)
          return { providers: yield* svc.get(), status: yield* svc.status() }
        }),
      )
      expect(result.providers).toEqual(catalog("bundled"))
      expect(result.status.origin).toBe("snapshot")
      expect(result.status.sources.every((source) => source.blockedUntil !== undefined)).toBe(true)
      expect(yield* Effect.promise(() => Bun.file(cacheFile).exists())).toBe(false)
    }),
  )

  it.live("returns an empty catalog instead of dying when nothing is available", () =>
    Effect.gen(function* () {
      routes.set(OPENCODE, blocked)
      routes.set(MODELSDEV, blocked)
      Flag.REDCODE_DISABLE_MODELS_FETCH = true
      const result = yield* run(
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          Flag.REDCODE_DISABLE_MODELS_FETCH = false
          return yield* svc.get().pipe(Effect.ensuring(Effect.sync(() => (Flag.REDCODE_DISABLE_MODELS_FETCH = true))))
        }),
      )
      expect(result).toEqual({})
    }),
  )

  it.live("never lets an HTML block page overwrite a good cache", () =>
    Effect.gen(function* () {
      const good = JSON.stringify(catalog("good"))
      yield* Effect.promise(async () => {
        await mkdir(Global.Path.cache, { recursive: true })
        await writeFile(cacheFile, good)
      })
      routes.set(OPENCODE, {
        status: 200,
        body: "<html><body>Access denied by Zscaler</body></html>",
        type: "text/html",
      })
      routes.set(MODELSDEV, { status: 200, body: JSON.stringify({ error: "blocked" }), type: "application/json" })
      const providers = yield* run(
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          yield* svc.refresh(true)
          return yield* svc.get()
        }),
      )
      expect(providers).toEqual(catalog("good"))
      expect(yield* Effect.promise(() => readFile(cacheFile, "utf8"))).toBe(good)
    }),
  )

  it.live("persists backoff so a restart does not hit blocked sources again", () =>
    Effect.gen(function* () {
      routes.set(OPENCODE, blocked)
      routes.set(MODELSDEV, blocked)
      yield* run(ModelsDev.Service.use((svc) => svc.refresh(true)))
      expect(hits.get(OPENCODE)).toBe(1)
      expect(hits.get(MODELSDEV)).toBe(1)

      // A new process: a fresh layer with no cache still skips both sources.
      yield* run(ModelsDev.Service.use((svc) => svc.refresh(false)))
      expect(hits.get(OPENCODE)).toBe(1)
      expect(hits.get(MODELSDEV)).toBe(1)

      // Once the backoff expires the source is tried again and the next wait grows to 6h.
      const state = yield* readState()
      state.sources["https://models.opencode.ai/api.json"].blockedUntil = Date.now() - 1000
      yield* Effect.promise(() => writeFile(stateFile, JSON.stringify(state)))
      yield* run(ModelsDev.Service.use((svc) => svc.refresh(false)))
      expect(hits.get(OPENCODE)).toBe(2)
      expect(hits.get(MODELSDEV)).toBe(1)
      const next = yield* readState()
      expect(next.sources["https://models.opencode.ai/api.json"].failures).toBe(2)
      expect(next.sources["https://models.opencode.ai/api.json"].blockedUntil).toBeGreaterThan(
        Date.now() + 5 * 3_600_000,
      )
    }),
  )

  it.live("logs one WARN per blocked source and no ERROR across refreshes and restarts", () =>
    Effect.gen(function* () {
      routes.set(OPENCODE, blocked)
      routes.set(MODELSDEV, blocked)
      const logs: LogLine[] = []
      yield* run(
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          yield* svc.refresh(true)
          yield* svc.refresh(true)
          yield* svc.refresh(false)
        }),
        logs,
      )
      yield* run(
        ModelsDev.Service.use((svc) => svc.refresh(true)),
        logs,
      )
      const warnings = logs.filter((line) => line.level === "Warn")
      expect(warnings).toHaveLength(2)
      expect(warnings[0].message).toContain("https://models.opencode.ai/api.json")
      expect(warnings[0].message).toContain("HTTP 403")
      expect(warnings[0].message).toContain("REDCODE_MODELS_URL")
      expect(warnings[0].message).toContain("models")
      expect(logs.filter((line) => line.level === "Error" || line.level === "Fatal")).toEqual([])
    }),
  )

  it.live("tries models.sources from the global config before the public endpoints", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        writeFile(
          path.join(configDir, "redcode.json"),
          // A base URL gets /api.json appended.
          `{ // corporate mirror\n "models": { "sources": ["${base}/mirror"] } }`,
        ),
      )
      routes.set(MIRROR, ok("mirror"))
      routes.set(OPENCODE, ok("public"))
      const result = yield* run(
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          yield* svc.refresh(true)
          return { providers: yield* svc.get(), status: yield* svc.status() }
        }),
      )
      expect(result.providers).toEqual(catalog("mirror"))
      expect(result.status.source).toBe(`${base}${MIRROR}`)
      expect(result.status.sources.map((source) => source.url)).toEqual([
        `${base}${MIRROR}`,
        "https://models.opencode.ai/api.json",
        "https://models.dev/api.json",
      ])
      expect(hits.get(OPENCODE)).toBeUndefined()
    }),
  )

  it.live("tries REDCODE_MODELS_URL before the config sources", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        writeFile(
          path.join(configDir, "redcode.json"),
          JSON.stringify({ models: { sources: [`${base}/mirror/api.json`] } }),
        ),
      )
      routes.set("/env/catalog.json", ok("env"))
      Flag.REDCODE_MODELS_URL = `${base}/env/catalog.json`
      const status = yield* run(
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          yield* svc.refresh(true)
          return yield* svc.status()
        }),
      ).pipe(Effect.ensuring(Effect.sync(() => (Flag.REDCODE_MODELS_URL = undefined))))
      expect(status.source).toBe(`${base}/env/catalog.json`)
      expect(hits.get(MIRROR)).toBeUndefined()
    }),
  )

  it.live("publishes models-dev.refreshed only when the catalog changed", () =>
    Effect.gen(function* () {
      routes.set(OPENCODE, ok("same"))
      const seen: string[] = []
      yield* run(
        Effect.gen(function* () {
          const svc = yield* ModelsDev.Service
          const events = yield* EventV2.Service
          const unsubscribe = yield* events.listen((event) => Effect.sync(() => seen.push(event.type)))
          yield* svc.refresh(true)
          yield* svc.refresh(true)
          routes.set(OPENCODE, ok("changed"))
          yield* svc.refresh(true)
          yield* unsubscribe
        }),
      )
      expect(seen).toEqual([ModelsDev.Event.Refreshed.type, ModelsDev.Event.Refreshed.type])
      expect(hits.get(OPENCODE)).toBe(3)
    }),
  )
})

describe("ModelsDev backoff schedule", () => {
  it.live("grows from 1h to 6h and caps at 24h", () =>
    Effect.sync(() => {
      expect(ModelsDev.backoff(1)).toBe(3_600_000)
      expect(ModelsDev.backoff(2)).toBe(6 * 3_600_000)
      expect(ModelsDev.backoff(3)).toBe(24 * 3_600_000)
      expect(ModelsDev.backoff(9)).toBe(24 * 3_600_000)
    }),
  )
})
