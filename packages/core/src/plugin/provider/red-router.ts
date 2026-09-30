import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Option, Schedule, Schema, Scope, Stream } from "effect"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { IntelligenceEvaluation } from "../../intelligence/evaluation.js"
import { redRouterEndpoint } from "../../intelligence/red-router-endpoint.js"
import { IntelligenceRouter } from "../../intelligence/router.js"
import { Integration } from "../../integration.js"
import { KV } from "../../kv.js"
import { Model } from "../../model.js"
import { ModelLimit } from "../../model-limit.js"
import { ModelsDev } from "../../models-dev.js"
import { Provider } from "../../provider.js"
import { ProviderRouter } from "../../provider-router.js"
import { Hash } from "@opencode/util/hash"
import { Money } from "@opencode/schema/money"
import { Router } from "@opencode/schema/router"

/**
 * Limits for a model that neither the router nor the models catalog describes. They are a guess, not
 * reported values: they keep proactive compaction working and stay small enough for most routed models.
 * The context is held back by the estimate reserve, since a guess is as likely too large as too small.
 */
const DEFAULT_CONTEXT = 128_000
const DEFAULT_OUTPUT = 8_192

const limitValue = Schema.optional(Schema.NullOr(Schema.Number))

const routerParameters = Schema.Struct({
  context_length: Schema.optional(Schema.Finite),
  max_completion_tokens: Schema.optional(Schema.Finite),
  reasoning: Schema.optional(Schema.Boolean),
  thinking_levels: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  thinking_can_disable: Schema.optional(Schema.Boolean),
  tools: Schema.optional(Schema.Boolean),
  forced_tool_choice: Schema.optional(Schema.Boolean),
  modalities: Schema.optional(
    Schema.Struct({
      input: Schema.optional(Schema.Array(Schema.String)),
      output: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
})

/** The provider behind a model or one of its offers, as RedRouter's `provider` block reports it. */
const catalogUpstream = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  slug: Schema.optional(Schema.String),
  category: Schema.optional(Schema.String),
  subscription: Schema.optional(Schema.Boolean),
})

const catalogHop = Schema.Struct({ slug: Schema.String, name: Schema.optional(Schema.String) })

const price = Schema.optional(Schema.NullOr(Schema.Finite))

/** One way RedRouter serves a flat model id. `pin_id` requests this offer only; null or absent cannot be pinned. */
const catalogOffer = Schema.Struct({
  id: Schema.String,
  pin_id: Schema.optional(Schema.NullOr(Schema.String)),
  provider: catalogUpstream,
  via: Schema.optional(Schema.Array(Schema.Unknown)),
  available: Schema.optional(Schema.Boolean),
  price: Schema.optional(Schema.NullOr(Schema.Struct({ input: price, output: price }))),
  free: Schema.optional(Schema.Boolean),
})

/** A combo member's own parameters; an entry without parameters says the router knows none. */
const catalogMember = Schema.Struct({ id: Schema.String, parameters: Schema.optional(Schema.Unknown) })

const catalogModel = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  display_name: Schema.optional(Schema.String),
  owned_by: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.Json),
  aliases: Schema.optional(Schema.Array(Schema.String)),
  via: Schema.optional(Schema.String),
  flat: Schema.optional(Schema.Boolean),
  // Other OpenAI-compatible servers may send null for fields only RedRouter fills.
  strategy: Schema.optional(Schema.NullOr(Schema.String)),
  offers: Schema.optional(Schema.NullOr(Schema.Array(Schema.Json))),
  parameters: Schema.optional(Schema.Json),
  // `lead`: the parameters are the lead member's; `strictest`: the strictest of all members'.
  parameters_basis: Schema.optional(Schema.NullOr(Schema.String)),
  member_parameters: Schema.optional(Schema.NullOr(Schema.Array(Schema.Json))),
  thinking_levels: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  type: Schema.optional(Schema.String),
  api_format: Schema.optional(Schema.String),
  supported_endpoints: Schema.optional(Schema.Array(Schema.String)),
  input_modalities: Schema.optional(Schema.Array(Schema.String)),
  output_modalities: Schema.optional(Schema.Array(Schema.String)),
  // OpenAI-compatible servers name their limits differently and some send null for unknown values.
  context_length: limitValue,
  max_context_length: limitValue,
  context_window: limitValue,
  max_input_tokens: limitValue,
  max_output_tokens: limitValue,
  max_output_length: limitValue,
  max_completion_tokens: limitValue,
  // OpenRouter reports the serving provider's own limits here.
  top_provider: Schema.optional(
    Schema.NullOr(Schema.Struct({ context_length: limitValue, max_completion_tokens: limitValue })),
  ),
  capabilities: Schema.optional(
    Schema.Struct({
      tool_calling: Schema.optional(Schema.Boolean),
      reasoning: Schema.optional(Schema.Boolean),
      supportsThinking: Schema.optional(Schema.Boolean),
      temperature: Schema.optional(Schema.Boolean),
      effort_tiers: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
})
const catalog = Schema.Struct({
  // `flat` lists one entry per model; routers from before flat ids do not say.
  id_format: Schema.optional(Schema.Unknown),
  data: Schema.Array(Schema.Unknown),
})

const decodeKey = Schema.decodeUnknownOption(
  Schema.Struct({
    role: Schema.optional(Schema.Unknown),
    mcp: Schema.optional(Schema.NullOr(Schema.Struct({ url: Schema.optional(Schema.Unknown) }))),
  }),
)

type CatalogModel = typeof catalogModel.Type
type RouterParameters = typeof routerParameters.Type
type Connection = {
  readonly baseURL: string
  readonly key: string
  readonly integrationID: Integration.ID
  readonly credential?: Credential.Info
}
/** What a RedRouter connection was found to be: its advertised features and the connection saved on the provider. */
type Inspection = { readonly features: readonly Router.Feature[]; readonly router?: Router.Connection }

export const RedRouterPlugin = routerPlugin({
  id: "red-router",
  name: "RedRouter",
  defaultBaseURL: "http://127.0.0.1:25050/v1",
  keyEnv: "RED_ROUTER_API_KEY",
  urlEnv: "RED_ROUTER_BASE_URL",
})
export const NineRouterPlugin = routerPlugin({
  id: "9router",
  name: "9Router",
  defaultBaseURL: "http://127.0.0.1:20128/v1",
  keyEnv: "NINE_ROUTER_API_KEY",
  urlEnv: "NINE_ROUTER_BASE_URL",
})

function routerPlugin(options: {
  id: "red-router" | "9router"
  name: string
  defaultBaseURL: string
  keyEnv: string
  urlEnv: string
}) {
  const providerID = Provider.ID.make(options.id)
  return define({
    id: `redcode.provider.${options.id}`,
    effect: Effect.fn(function* (ctx) {
      const credentials = yield* Credential.Service
      const kv = yield* KV.Service
      const bus = yield* Bus.Service
      const modelsDev = yield* ModelsDev.Service
      const scope = yield* Scope.Scope
      const loaded: {
        models: readonly CatalogModel[]
        names: ReturnType<typeof catalogNames>
        connection?: Connection
        digest?: string
        inspection: Inspection
        catalogVersion?: string
      } = { models: [], names: catalogNames(yield* modelsDev.get()), inspection: { features: [] } }
      // The registered MCP server, keyed by what it is reached with, so a change reloads MCP once.
      const mcpServer = () =>
        loaded.connection && loaded.inspection.router?.mcp
          ? `${loaded.inspection.router.mcp}\n${loaded.connection.key}`
          : undefined

      const resolve = Effect.fn("RouterProvider.resolve")(function* () {
        const all = (yield* credentials.all()).toReversed()
        const stored = all
          .filter((item) => all.find((candidate) => candidate.integrationID === item.integrationID)?.id === item.id)
          .filter(
            (item) =>
              item.integrationID === Integration.ID.make(options.id) || item.value.metadata?.router === options.id,
          )
          .find((item) => item.value.type === "key" || (item.value.type === "oauth" && item.value.expires > Date.now()))
        const key =
          stored?.value.type === "key"
            ? stored.value.key
            : stored?.value.type === "oauth"
              ? stored.value.access
              : process.env[options.keyEnv]
        if (!key) return
        const baseURL =
          options.id === "red-router"
            ? redRouterEndpoint(stored)
            : routerEndpoint(stored, process.env[options.urlEnv] ?? options.defaultBaseURL)
        if (!baseURL) return
        return {
          baseURL,
          key,
          integrationID: stored?.integrationID ?? Integration.ID.make(providerID),
          ...(stored ? { credential: stored } : {}),
        } satisfies Connection
      })

      /**
       * What a RedRouter says about itself (its capabilities, cached by the detector) and about the key:
       * its role and MCP server, from the model list's response headers or else `GET /key`. Never fails.
       */
      const inspect = Effect.fn("RouterProvider.inspect")(function* (connection: Connection, headers: Headers) {
        if (options.id !== "red-router") return { features: [] } satisfies Inspection
        const detection = (yield* IntelligenceRouter.detect(connection.credential))?.detection
        const role = ProviderRouter.keyRole(headers.get(ProviderRouter.Header.keyRole)?.trim())
        const mcp = role ? ProviderRouter.mcpURL(connection.baseURL, headers.get(ProviderRouter.Header.mcp)) : undefined
        const key = role ? { role, ...(mcp ? { mcp } : {}) } : yield* Effect.promise(() => keyInfo(connection))
        const red = detection?.kind === "red-router" ? detection : undefined
        if (!red && !key) return { features: [] } satisfies Inspection
        return {
          features: red?.features ?? [],
          router: {
            kind: "red-router",
            ...(red?.instanceID ? { instanceID: red.instanceID } : {}),
            ...(red?.version ? { version: red.version } : {}),
            ...key,
          },
        } satisfies Inspection
      })

      const refresh = Effect.fn("RouterProvider.refresh")(function* () {
        const connection = yield* resolve()
        const mcpBefore = mcpServer()
        if (loaded.connection?.baseURL !== connection?.baseURL || loaded.connection?.key !== connection?.key) {
          loaded.models = []
          loaded.digest = undefined
          loaded.inspection = { features: [] }
          loaded.catalogVersion = undefined
        }
        loaded.connection = connection
        if (mcpServer() !== mcpBefore) yield* ctx.mcp.reload()
        if (!connection) {
          loaded.models = []
          loaded.digest = undefined
          yield* ctx.provider.reload()
          return
        }
        const cacheKey = `${options.id}:models:${Hash.sha256(`${connection.baseURL}\n${connection.key}`)}`
        const count = yield* kv.get(`${cacheKey}:count`)
        if (typeof count === "number" && Number.isSafeInteger(count) && count > 0 && count < 10_000) {
          const chunks = yield* Effect.forEach(
            Array.from({ length: count }, (_, index) => index),
            (index) => kv.get(`${cacheKey}:${index}`),
          )
          const decoded = chunks.map((chunk) =>
            Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Array(catalogModel))(chunk)),
          )
          if (decoded.every((chunk) => chunk !== undefined)) {
            loaded.models = decoded.flatMap((chunk) => chunk ?? [])
            loaded.digest = Hash.sha256(JSON.stringify(loaded.models))
          }
        }
        yield* ctx.provider.reload()
        const fetched = yield* Effect.tryPromise({
          try: async (signal) => {
            const request = (suffix: string) =>
              fetch(`${connection.baseURL}/${suffix}`, {
                redirect: "error",
                signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
                headers: { accept: "application/json", authorization: `Bearer ${connection.key}` },
              })
            const filtered = await request(options.id === "red-router" ? "models?capabilities=chat" : "models")
            const result =
              options.id === "red-router" && [400, 404, 405].includes(filtered.status)
                ? await request("models")
                : filtered
            if (!result.ok) throw new Error(`${options.name} model catalog HTTP ${result.status}`)
            return { body: (await result.json()) as unknown, headers: result.headers }
          },
          catch: (cause) => cause,
        })
        const response = yield* Schema.decodeUnknownEffect(catalog)(fetched.body)
        const current = yield* resolve()
        if (!current || current.baseURL !== connection.baseURL || current.key !== connection.key) return
        const flat = response.id_format === "flat"
        const models = response.data.flatMap((item) => {
          const decoded = Schema.decodeUnknownOption(catalogModel)(item)
          if (Option.isNone(decoded)) return []
          // In a flat list a combo carrying offers is a flat model id, even when the entry does not say so.
          return [
            flat && decoded.value.owned_by === "combo" && decoded.value.offers?.length
              ? { ...decoded.value, flat: true }
              : decoded.value,
          ]
        })
        if (response.data.length && !models.length) throw new Error(`${options.name} returned no valid model entries`)
        const inspection = yield* inspect(current, fetched.headers)
        loaded.catalogVersion =
          fetched.headers.get(ProviderRouter.Header.catalogVersion)?.trim() || loaded.catalogVersion
        const digest = Hash.sha256(JSON.stringify(models))
        if (digest === loaded.digest && JSON.stringify(inspection) === JSON.stringify(loaded.inspection)) return
        const mcpInspected = mcpServer()
        loaded.inspection = inspection
        const changed = digest !== loaded.digest
        const previous = loaded.models
        loaded.models = models
        loaded.digest = digest
        yield* ctx.provider.reload()
        if (mcpServer() !== mcpInspected) yield* ctx.mcp.reload()
        if (!changed) return
        const chunks = Array.from({ length: Math.ceil(loaded.models.length / 100) }, (_, index) =>
          loaded.models.slice(index * 100, (index + 1) * 100),
        )
        yield* Effect.forEach(chunks, (chunk, index) => kv.set(`${cacheKey}:${index}`, chunk), {
          discard: true,
        })
        yield* kv.set(`${cacheKey}:count`, chunks.length)
        // A first read has nothing to compare against. Published even when no model was added or
        // removed: limits or modes may have changed, and clients decide what is worth announcing.
        if (previous.length === 0) return
        yield* bus.publish(Router.Event.CatalogUpdated, {
          providerID,
          name: options.name,
          ...catalogChanges(previous, models),
        })
      })
      const safeRefresh = () =>
        refresh().pipe(
          Effect.catchCause((cause) => Effect.logWarning(`${options.name} model catalog refresh failed`, { cause })),
        )
      const features = () => new Set(loaded.inspection.features)

      yield* ctx.integration.transform((integrations) => {
        integrations.update(providerID, (integration) => (integration.name = options.name))
        integrations.method.update({
          integrationID: providerID,
          method: {
            type: "key",
            label: `${options.name} API key`,
            form: [
              {
                type: "string",
                key: "baseURL",
                title: `${options.name} API URL`,
                description: "The OpenAI-compatible API endpoint, usually ending in /v1.",
                placeholder: options.defaultBaseURL,
                default: process.env[options.urlEnv] ?? options.defaultBaseURL,
                format: "uri",
                required: true,
              },
            ],
          },
        })
        integrations.method.update({ integrationID: providerID, method: { type: "env", names: [options.keyEnv] } })
      })
      yield* ctx.provider.transform((providers) => {
        const connection = loaded.connection
        if (!connection) return
        const enabled = features()
        providers.add({
          info: {
            id: providerID,
            name: options.name,
            integrationID: connection.integrationID,
            activation: "auto",
            package: "@opencode/ai/providers/openai-compatible",
            settings: { baseURL: connection.baseURL, provider: providerID },
            ...(loaded.inspection.router ? { router: loaded.inspection.router } : {}),
          },
          models: loaded.models.flatMap((item) => routerModel(item, providerID, loaded.names, enabled)),
          sourceConnection: connection.credential
            ? {
                type: "credential",
                id: connection.credential.id,
                label: connection.credential.label,
                method: connection.credential.value.type,
              }
            : { type: "env", name: options.keyEnv },
        })
      })
      if (options.id === "red-router")
        yield* ctx.mcp.transform((servers) => {
          const connection = loaded.connection
          const url = loaded.inspection.router?.mcp
          // A server the user configured under the same name wins.
          if (!connection || !url || servers.get(ProviderRouter.MCP_SERVER)) return
          servers.set(ProviderRouter.MCP_SERVER, {
            type: "remote",
            url,
            headers: { Authorization: `Bearer ${connection.key}` },
            // The key is the credential; RedRouter's MCP server never asks for OAuth.
            oauth: false,
          })
        })
      yield* ctx.session.hook(
        "model.request",
        (event) =>
          Effect.sync(() => {
            Object.assign(
              event.headers,
              ProviderRouter.requestHeaders({
                features: features(),
                variant: event.model.variant,
                strategy: loaded.models.find((item) => item.id === event.model.id)?.strategy ?? undefined,
                // Compaction and validation must see the whole prompt.
                tokenSaver: event.kind === "compaction" || event.kind === "generate" ? false : undefined,
                guidance: ProviderRouter.guidance(event.sessionID),
              }),
            )
          }),
        { providerID },
      )
      if (options.id === "red-router")
        yield* ctx.session.hook(
          "http.response",
          Effect.fn(function* (event) {
            const report = ProviderRouter.reported(event.response.headers)
            if (!report) return
            // Combos, members or limits changed at the router: read the catalog again, once per version.
            if (report.catalogVersion && report.catalogVersion !== loaded.catalogVersion) {
              loaded.catalogVersion = report.catalogVersion
              yield* safeRefresh().pipe(Effect.forkIn(scope))
            }
            if (event.kind !== "primary") return
            ProviderRouter.observe(event.sessionID, report)
            const body = event.response.body
            if (
              !report.servedModel ||
              report.costUSD !== undefined ||
              !body ||
              !event.response.headers.get("content-type")?.includes("text/event-stream")
            )
              return
            // A stream reports its cost in its final usage chunk instead of a header.
            event.response = new Response(
              body.pipeThrough(
                ProviderRouter.usageCost((costUSD) => ProviderRouter.observe(event.sessionID, { costUSD })),
              ),
              { status: event.response.status, statusText: event.response.statusText, headers: event.response.headers },
            )
          }),
          { providerID },
        )
      yield* bus.subscribe([Credential.Event.Updated, Credential.Event.Switched]).pipe(
        Stream.runForEach(() => safeRefresh()),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* bus.subscribe(ModelsDev.Event.Refreshed).pipe(
        Stream.runForEach(() =>
          modelsDev.get().pipe(
            Effect.flatMap((catalog) => {
              loaded.names = catalogNames(catalog)
              return ctx.provider.reload()
            }),
          ),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* Effect.forkScoped(safeRefresh().pipe(Effect.repeat(Schedule.spaced("5 minutes"))), {
        startImmediately: true,
      })
    }),
  })
}

/**
 * How a router's model list moved between two reads, counted by model id. The router keeps no
 * record of renames, so a renamed model counts as one removed and one added.
 */
export function catalogChanges(previous: ReadonlyArray<{ id: string }>, next: ReadonlyArray<{ id: string }>) {
  const before = new Set(previous.map((item) => item.id))
  const after = new Set(next.map((item) => item.id))
  return {
    added: [...after].filter((id) => !before.has(id)).length,
    removed: [...before].filter((id) => !after.has(id)).length,
    renamed: 0,
  }
}

function routerEndpoint(credential: Credential.Info | undefined, fallback: string) {
  const value = credential?.value
  const configured =
    value?.type === "key" && typeof value.configuration?.baseURL === "string"
      ? value.configuration.baseURL
      : typeof value?.metadata?.baseURL === "string"
        ? value.metadata.baseURL
        : fallback
  if (!URL.canParse(configured)) return
  const url = new URL(configured)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/models$/, "") || "/v1"
  return url.href.replace(/\/+$/, "")
}

export function routerModel(
  item: CatalogModel,
  providerID: Provider.ID,
  names: ReturnType<typeof catalogNames>,
  features: ReadonlySet<Router.Feature> = new Set(),
): Model.Info[] {
  if (!item.id || IntelligenceEvaluation.isJev(item.id)) return []
  if (item.type !== undefined && !["chat", "llm", "text"].includes(item.type)) return []
  if (item.api_format !== undefined && !["chat-completions", "responses", "openai-responses"].includes(item.api_format))
    return []
  const members = (item.member_parameters ?? []).flatMap((entry) => {
    const member = Option.getOrUndefined(Schema.decodeUnknownOption(catalogMember)(entry))
    if (!member) return []
    const parameters = Option.getOrUndefined(Schema.decodeUnknownOption(routerParameters)(member.parameters))
    return [{ id: member.id, ...(parameters ? { parameters } : {}) }]
  })
  // A combo that states no parameters of its own is planned for its strictest member.
  const parameters =
    Option.getOrUndefined(Schema.decodeUnknownOption(routerParameters)(item.parameters)) ??
    strictest(members.flatMap((member) => (member.parameters ? [member.parameters] : [])))
  const output =
    parameters?.modalities?.output ??
    item.output_modalities ??
    (item.type === undefined || item.type === "chat" ? ["text"] : [])
  if (!output.includes("text")) return []
  const endpoints = item.supported_endpoints ?? []
  const responses =
    item.api_format === "responses" ||
    item.api_format === "openai-responses" ||
    (item.api_format === undefined &&
      !endpoints.some((value) => /chat|completions/.test(value)) &&
      endpoints.some((value) => /\/?responses$/.test(value)))
  const chat = endpoints.length === 0 || endpoints.some((value) => /chat|completions/.test(value))
  if (!responses && !chat) return []
  const limit = routerLimit(item, parameters, names.limits)
  const id = Model.ID.make(item.id)
  const input = parameters?.modalities?.input ?? item.input_modalities ?? ["text"]
  const levels =
    parameters?.thinking_levels !== undefined
      ? (parameters.thinking_levels ?? [])
      : (item.thinking_levels ?? item.capabilities?.effort_tiers ?? [])
  const reasoning =
    parameters?.reasoning ?? item.capabilities?.reasoning ?? item.capabilities?.supportsThinking ?? levels.length > 0
  const variants = reasoningVariants(reasoning, levels, parameters?.thinking_can_disable, features)
  const route = Router.route(item.id)
  const source = Option.getOrUndefined(Schema.decodeUnknownOption(catalogUpstream)(item.provider))
  const offers = item.flat ? routerOffers(item.offers, item.id, names) : []
  // A flat id names no provider: it is served by its lead offer, whose routers come before it.
  const lead = Router.leadOffer({ offers })
  // A flat ID does not identify its serving provider. For routed IDs the catalog's
  // owner is authoritative even when the public prefix is an alias (for example oc/).
  const owner =
    source?.id ?? (item.flat ? undefined : item.owned_by && item.owned_by !== "combo" ? item.owned_by : route.provider)
  const upstream =
    lead?.provider ??
    (owner
      ? {
          id: owner,
          name: source?.name || names.providers.get(owner) || owner,
          ...(source?.slug ? { slug: source.slug } : {}),
          ...(source?.category ? { category: source.category } : {}),
          ...(source?.subscription === undefined ? {} : { subscription: source.subscription }),
        }
      : item.owned_by === "combo"
        ? { id: "combo", name: "Combo", category: "combo" }
        : undefined)
  const via = lead ? hops(lead) : item.via
  const display = item.display_name?.trim() || item.name?.trim()
  const name =
    display && display !== item.id
      ? display
      : owner
        ? (names.models.get(`${owner}/${route.model}`) ?? names.models.get(`${owner}/${item.id}`) ?? route.model)
        : item.id
  // Falling back per request may land on any member, so one that refuses a forced tool choice rules it out.
  const forcedToolChoice = members.some((member) => member.parameters?.forced_tool_choice === false)
    ? false
    : parameters?.forced_tool_choice
  const shared = {
    package: responses
      ? "@opencode/ai/providers/openai-compatible-responses"
      : "@opencode/ai/providers/openai-compatible",
    settings: { provider: providerID },
    capabilities: {
      tools: parameters?.tools ?? item.capabilities?.tool_calling === true,
      reasoning,
      ...(item.capabilities?.temperature === undefined ? {} : { temperature: item.capabilities.temperature }),
      input: [...input],
      output: [...output],
    },
    ...(forcedToolChoice === undefined ? {} : { compatibility: { forcedToolChoice } }),
  }
  // Each offer that can be pinned is a model of its own under its pin id, so a pinned choice resolves,
  // labels and plans like any routed model: the offer's provider, routers and price, and its own limits
  // and thinking levels when the router listed them. An offer switched off for the flat id still pins.
  const pinned = offers.flatMap((offer): Model.Info[] => {
    if (!offer.pinID) return []
    const pinID = Model.ID.make(offer.pinID)
    const member = members.find((candidate) => candidate.id === offer.id)?.parameters
    const context = firstPositive([member?.context_length]) ?? limit.context
    const pinnedVariants =
      !member || member.thinking_levels === undefined
        ? variants
        : reasoningVariants(
            member.reasoning ?? reasoning,
            member.thinking_levels ?? [],
            member.thinking_can_disable,
            features,
          )
    const pinnedVia = hops(offer)
    return [
      {
        ...Model.Info.default(providerID, pinID),
        name,
        upstream: offer.provider,
        ...(pinnedVia ? { via: pinnedVia } : {}),
        pinOf: id,
        ...shared,
        variants: pinnedVariants,
        ...(pinnedVariants.length ? { reasoningVariantIDs: pinnedVariants.map((variant) => variant.id) } : {}),
        cost: offer.price
          ? [
              {
                input: Money.USDPerMillionTokens.make(offer.price.input ?? 0),
                output: Money.USDPerMillionTokens.make(offer.price.output ?? 0),
                cache: { read: Money.USDPerMillionTokens.zero, write: Money.USDPerMillionTokens.zero },
              },
            ]
          : [],
        limit: {
          context,
          ...(limit.input !== undefined && limit.input < context ? { input: limit.input } : {}),
          output: Math.min(firstPositive([member?.max_completion_tokens]) ?? limit.output, context),
        },
      },
    ]
  })
  return [
    {
      ...Model.Info.default(providerID, id),
      name,
      ...(upstream ? { upstream } : {}),
      ...(via ? { via } : {}),
      ...(item.aliases?.length ? { aliases: item.aliases } : {}),
      ...(item.flat ? { flat: true } : {}),
      ...(offers.length ? { offers } : {}),
      ...shared,
      variants,
      ...(variants.length ? { reasoningVariantIDs: variants.map((variant) => variant.id) } : {}),
      limit,
    },
    ...pinned,
  ]
}

/**
 * A model's reasoning variants: one per thinking level (without `none` when it cannot stop thinking),
 * and first `auto`, which leaves the effort to RedRouter's reasoning autopilot, when the router
 * accepts it and there are two effort levels at least to choose between.
 */
function reasoningVariants(
  reasoning: boolean,
  levels: ReadonlyArray<string>,
  canDisable: boolean | undefined,
  features: ReadonlySet<Router.Feature>,
): Model.Info["variants"] {
  if (!reasoning) return []
  const allowed = [
    ...new Set(
      levels.filter((level) => level && level !== ProviderRouter.AUTO && (level !== "none" || canDisable !== false)),
    ),
  ]
  return [
    ...(ProviderRouter.supportsAuto(allowed, features) ? [{ id: Model.VariantID.make(ProviderRouter.AUTO) }] : []),
    ...allowed.map((level) => ({ id: Model.VariantID.make(level), settings: { reasoningEffort: level } })),
  ]
}

/**
 * RedRouter's `offers` of a flat model id, in policy order. An offer without an id or a provider is
 * dropped. A missing `pin_id` means the offer cannot be pinned, like null, and so does one equal to the
 * flat id: the vendor's own offer id can be the flat id, which asks for the flat model.
 */
function routerOffers(
  value: ReadonlyArray<unknown> | null | undefined,
  flatID: string,
  names: ReturnType<typeof catalogNames>,
): Router.Offer[] {
  return (value ?? []).flatMap((entry) => {
    const offer = Option.getOrUndefined(Schema.decodeUnknownOption(catalogOffer)(entry))
    if (!offer?.id.trim() || !offer.provider.id.trim()) return []
    const pin = offer.pin_id?.trim()
    const input = dollars(offer.price?.input)
    const output = dollars(offer.price?.output)
    return [
      {
        id: offer.id,
        ...(pin && pin !== flatID ? { pinID: pin } : {}),
        provider: {
          id: offer.provider.id,
          name:
            offer.provider.name?.trim() ||
            names.providers.get(offer.provider.id) ||
            offer.provider.slug ||
            offer.provider.id,
          ...(offer.provider.slug ? { slug: offer.provider.slug } : {}),
          ...(offer.provider.category ? { category: offer.provider.category } : {}),
          ...(offer.provider.subscription === undefined ? {} : { subscription: offer.provider.subscription }),
        },
        via: (offer.via ?? []).flatMap((entry) => {
          const hop = Option.getOrUndefined(Schema.decodeUnknownOption(catalogHop)(entry))
          const slug = hop?.slug.trim()
          return slug ? [{ slug, name: hop?.name?.trim() || Router.hopName(slug) }] : []
        }),
        available: offer.available !== false,
        ...(input === undefined && output === undefined
          ? {}
          : {
              price: {
                ...(input === undefined ? {} : { input }),
                ...(output === undefined ? {} : { output }),
              },
            }),
        free: offer.free === true,
      },
    ]
  })
}

/** The routers an offer passes through before its provider, outermost first, as one label. */
function hops(offer: Router.Offer) {
  return offer.via.map((hop) => hop.name).join(Router.HOP_SEPARATOR) || undefined
}

/**
 * The strictest of a combo's member parameters: the smallest limits, the thinking levels every member
 * takes, and a capability only when every member that says has it. Undefined when no member says.
 */
function strictest(members: ReadonlyArray<RouterParameters>): RouterParameters | undefined {
  const first = members[0]
  if (!first) return
  const least = (values: ReadonlyArray<number | undefined>) => {
    const known = values.filter((value): value is number => value !== undefined)
    return known.length ? Math.min(...known) : undefined
  }
  const all = (values: ReadonlyArray<boolean | undefined>) =>
    values.includes(false) ? false : values.every((value) => value === true) ? true : undefined
  const context = least(members.map((member) => member.context_length))
  const output = least(members.map((member) => member.max_completion_tokens))
  const levels = members.every((member) => member.thinking_levels !== undefined)
    ? members
        .slice(1)
        .reduce<ReadonlyArray<string>>(
          (kept, member) => kept.filter((level) => (member.thinking_levels ?? []).includes(level)),
          first.thinking_levels ?? [],
        )
    : undefined
  const reasoning = all(members.map((member) => member.reasoning))
  const canDisable = all(members.map((member) => member.thinking_can_disable))
  const tools = all(members.map((member) => member.tools))
  const forced = all(members.map((member) => member.forced_tool_choice))
  return {
    ...(context === undefined ? {} : { context_length: context }),
    ...(output === undefined ? {} : { max_completion_tokens: output }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(levels === undefined ? {} : { thinking_levels: levels }),
    ...(canDisable === undefined ? {} : { thinking_can_disable: canDisable }),
    ...(tools === undefined ? {} : { tools }),
    ...(forced === undefined ? {} : { forced_tool_choice: forced }),
  }
}

function dollars(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

/**
 * What a RedRouter key is, from `GET /key`: its role and where its MCP server is, or undefined when
 * the router does not say (an older router, a refused key). The MCP URL is kept only on the router's
 * own origin, so the key is never sent anywhere else. Never rejects.
 */
async function keyInfo(connection: Connection) {
  // Redirects are refused so the key never follows a hop to another address.
  const body = await fetch(`${connection.baseURL}/key`, {
    redirect: "error",
    signal: AbortSignal.timeout(3_000),
    headers: { accept: "application/json", authorization: `Bearer ${connection.key}` },
  })
    .then((response) => (response.ok ? (response.json() as Promise<unknown>) : undefined))
    .catch(() => undefined)
  const key = Option.getOrUndefined(decodeKey(body))
  const role = ProviderRouter.keyRole(key?.role)
  if (!role) return
  const mcp = ProviderRouter.mcpURL(connection.baseURL, key?.mcp?.url)
  return { role, ...(mcp ? { mcp } : {}) }
}

/**
 * Router-reported limits win (RedRouter's `parameters` first, then the entry's own fields, then the serving
 * provider's `top_provider` limits), then the models catalog, then a guess held back by the estimate reserve.
 */
function routerLimit(
  item: CatalogModel,
  parameters: typeof routerParameters.Type | undefined,
  catalog: ReturnType<typeof catalogNames>["limits"],
): Model.Info["limit"] {
  const reported = {
    context: firstPositive([
      parameters?.context_length,
      item.context_length,
      item.max_context_length,
      item.context_window,
      item.max_input_tokens,
      item.top_provider?.context_length,
    ]),
    output: firstPositive([
      parameters?.max_completion_tokens,
      item.max_output_tokens,
      item.max_output_length,
      item.max_completion_tokens,
      item.top_provider?.max_completion_tokens,
    ]),
  }
  // Routers prefix upstream ids (`cc/claude-...`), so leading segments are dropped until the catalog knows one.
  const known =
    reported.context !== undefined && reported.output !== undefined
      ? undefined
      : item.id
          .split("/")
          .map((_, start, parts) => catalog.get(parts.slice(start).join("/")))
          .find((entry) => entry !== undefined)
  const context = reported.context ?? known?.context ?? ModelLimit.conservative(DEFAULT_CONTEXT)
  const input = firstPositive([item.max_input_tokens])
  return {
    context,
    ...(input !== undefined && input < context ? { input } : {}),
    output: Math.min(firstPositive([reported.output, known?.output]) ?? DEFAULT_OUTPUT, context),
  }
}

function firstPositive(values: ReadonlyArray<number | null | undefined>) {
  const value = values.find(
    (candidate): candidate is number => typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0,
  )
  return value === undefined ? undefined : Math.floor(value)
}

function catalogNames(catalog: readonly ModelsDev.Snapshot[]) {
  return {
    providers: new Map(catalog.map((item) => [String(item.info.id), item.info.name])),
    models: new Map(catalog.flatMap((item) => item.models.map((model) => [`${item.info.id}/${model.id}`, model.name]))),
    // The first provider that lists a model id with a known context wins.
    limits: new Map(
      catalog
        .flatMap((item) => item.models)
        .filter((model) => model.limit.context > 0)
        .map((model) => [String(model.id), { context: model.limit.context, output: model.limit.output }] as const)
        .toReversed(),
    ),
  }
}
