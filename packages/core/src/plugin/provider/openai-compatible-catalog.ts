import { subscribeFiltered } from "@opencode/plugin/effect/event"
import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Stream } from "effect"
import { Config } from "../../config.js"
import { Integration } from "../../integration.js"
import { IntegrationConnection } from "../../integration/connection.js"
import { KV } from "../../kv.js"
import { Provider } from "../../provider.js"
import { discover, normalizeBaseURL, providerConfig, type Listed } from "./openai-compatible.js"

const packages = new Set([
  "@opencode/ai/providers/openai-compatible",
  "@opencode/ai/providers/openai-compatible-responses",
])
const reserved = new Set(["red-router", "9router", "openai", "ollama", "lmstudio", "vllm"])
type Inventory = { models: readonly Listed[]; removed: readonly string[]; catalog: Provider.Catalog }

/** Explicit refresh for configured OpenAI-compatible endpoints. Configuration is never rewritten. */
export const OpenAICompatibleCatalogPlugin = define({
  id: "redcode.provider.openai-compatible-catalog",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const integrations = yield* Integration.Service
    const providers = yield* Provider.Service
    const kv = yield* KV.Service
    const registrations = new Map<string, { dispose: Effect.Effect<void> }>()
    const inventories = new Map<string, Inventory>()
    let filters = new Map<string, { include?: readonly string[]; exclude?: readonly string[] }>()
    let eligible = new Set<string>()
    let revision = 0
    const sequences = new Map<string, number>()

    const refresh = Effect.fn("OpenAICompatibleCatalog.refresh")(function* (id: string) {
      const generation = revision
      const ticket = (sequences.get(id) ?? 0) + 1
      sequences.set(id, ticket)
      const provider = yield* providers.get(Provider.ID.make(id))
      const url =
        typeof provider?.settings?.baseURL === "string" ? normalizeBaseURL(provider.settings.baseURL) : undefined
      if (!provider || !url || !packages.has(provider.package))
        return yield* Effect.fail(new Error("This endpoint is no longer configured"))
      const integrationID = provider.integrationID ?? Integration.ID.make(id)
      const connection = yield* integrations.connection.active(integrationID)
      const credential = connection
        ? yield* integrations.connection
            .resolve(connection)
            .pipe(Effect.mapError(() => new Error("Could not resolve the active connection")))
        : undefined
      const key =
        credential?.type === "key"
          ? credential.key
          : credential?.type === "oauth"
            ? credential.access
            : typeof provider.settings?.apiKey === "string"
              ? provider.settings.apiKey
              : undefined
      if (!key) return yield* Effect.fail(new Error("Connect this endpoint before refreshing its models"))
      const endpoint = {
        providerID: id,
        name: provider.name,
        baseURL: url,
        responses: provider.package.endsWith("-responses"),
        headers: provider.headers ?? {},
        models: [],
      }
      const listed = yield* discover(endpoint, key).pipe(
        Effect.tapError(() =>
          Effect.gen(function* () {
            if (generation !== revision || ticket !== sequences.get(id)) return
            const previous = inventories.get(id)
            inventories.set(id, {
              models: previous?.models ?? [],
              removed: previous?.removed ?? [],
              catalog: {
                status: previous ? "stale" : "error",
                ...(previous?.catalog.updatedAt === undefined ? {} : { updatedAt: previous.catalog.updatedAt }),
              },
            })
            yield* ctx.provider.reload()
          }),
        ),
      )
      const active = yield* integrations.connection.active(integrationID)
      const current = yield* providers.get(Provider.ID.make(id))
      const activeCredential = active
        ? yield* integrations.connection
            .resolve(active)
            .pipe(Effect.mapError(() => new Error("Could not resolve the active connection")))
        : undefined
      const activeKey =
        activeCredential?.type === "key"
          ? activeCredential.key
          : activeCredential?.type === "oauth"
            ? activeCredential.access
            : typeof current?.settings?.apiKey === "string"
              ? current.settings.apiKey
              : undefined
      if (
        generation !== revision ||
        ticket !== sequences.get(id) ||
        key !== activeKey ||
        IntegrationConnection.key(connection) !== IntegrationConnection.key(active) ||
        current?.settings?.baseURL !== provider.settings?.baseURL ||
        current?.package !== provider.package ||
        JSON.stringify(current?.headers) !== JSON.stringify(provider.headers)
      )
        return yield* Effect.fail(new Error("The connection changed while models were loading; refresh again"))
      const marker = yield* kv.get(`openai-compatible:managed:${id}`)
      const record =
        marker && typeof marker === "object" && !Array.isArray(marker) ? (marker as Record<string, unknown>) : undefined
      const managed =
        record?.baseURL === url && record.models && typeof record.models === "object" && !Array.isArray(record.models)
          ? record.models
          : {}
      const entries = yield* config.entries()
      const listedIDs = new Set(listed.map((model) => model.id))
      const removed = Object.entries(managed).flatMap(([modelID, original]) => {
        if (listedIDs.has(modelID)) return []
        const declarations = entries.flatMap((entry) =>
          entry.type === "document" && entry.info.providers?.[id]?.models?.[modelID]
            ? [entry.info.providers[id].models![modelID]]
            : [],
        )
        return declarations.length && declarations.every((value) => JSON.stringify(value) === JSON.stringify(original))
          ? [modelID]
          : []
      })
      inventories.set(id, { models: listed, removed, catalog: { status: "ready", updatedAt: Date.now() } })
      yield* ctx.provider.reload()
      yield* ctx.model.reload()
    })
    yield* ctx.provider.transform((editor) => {
      for (const id of eligible)
        editor.update(id, (provider) => {
          provider.catalog = inventories.get(id)?.catalog ?? { status: "ready" }
        })
    })
    yield* ctx.model.transform((editor) => {
      for (const [id, inventory] of inventories) {
        if (!eligible.has(id)) continue
        for (const modelID of inventory.removed) editor.remove(id, modelID)
        const endpoint = { providerID: id, name: id, baseURL: "", responses: false, headers: {}, models: [] }
        for (const [modelID, info] of Object.entries(providerConfig(endpoint, inventory.models).models)) {
          const filter = filters.get(id)
          if ((filter?.include && !filter.include.includes(modelID)) || filter?.exclude?.includes(modelID)) continue
          if (editor.get(id, modelID)) continue
          editor.update(id, modelID, (model) => {
            model.name = info.name
            if (info.limit?.context) model.limit.context = info.limit.context
            if (info.limit?.input) model.limit.input = info.limit.input
            if (info.limit?.output) model.limit.output = Math.min(info.limit.output, model.limit.context)
          })
        }
      }
    })
    const sync = Effect.fn("OpenAICompatibleCatalog.sync")(function* () {
      revision++
      inventories.clear()
      const entries = yield* config.entries()
      const next = new Map<string, string>()
      const nextFilters = new Map<string, { include?: readonly string[]; exclude?: readonly string[] }>()
      for (const entry of entries)
        if (entry.type === "document")
          for (const [id, provider] of Object.entries(entry.info.providers ?? {})) {
            if (provider.package) next.set(id, provider.package)
            const previous = nextFilters.get(id)
            nextFilters.set(id, {
              include: provider.includeModels ?? previous?.include,
              exclude: provider.excludeModels ?? previous?.exclude,
            })
          }
      filters = nextFilters
      eligible = new Set([...next].filter(([id, pkg]) => packages.has(pkg) && !reserved.has(id)).map(([id]) => id))
      for (const [id, registration] of registrations)
        if (!eligible.has(id)) {
          yield* registration.dispose
          registrations.delete(id)
          inventories.delete(id)
        }
      for (const id of eligible)
        if (!registrations.has(id)) registrations.set(id, yield* ctx.provider.onRefresh(id, () => refresh(id)))
      yield* ctx.provider.reload()
      yield* ctx.model.reload()
    })
    yield* sync()
    yield* subscribeFiltered(ctx.event, { types: ["config.updated"] }).pipe(
      Stream.filter((event) => event.type === "config.updated"),
      Stream.runForEach(() => sync()),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* subscribeFiltered(ctx.event, { types: ["credential.switched", "credential.updated"] }).pipe(
      Stream.filter((event) => event.type === "credential.switched" || event.type === "credential.updated"),
      Stream.runForEach(() =>
        Effect.sync(() => {
          revision++
          inventories.clear()
        }).pipe(Effect.andThen(ctx.provider.reload()), Effect.andThen(ctx.model.reload())),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
