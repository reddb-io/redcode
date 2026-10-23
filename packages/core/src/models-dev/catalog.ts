export * as ModelsDevCatalog from "./catalog.js"

import { Schema } from "effect"
import { Model } from "../model.js"
import { Provider } from "../provider.js"
import { Variant } from "../variant.js"
import { Money } from "@opencode/schema/money"
import type { Snapshot } from "../models-dev.js"

const json = Schema.Record(Schema.String, Schema.Json)
const price = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
const optional = Schema.optional
const Reasoning = Schema.StructWithRest(
  Schema.Struct({
    supported: Schema.Boolean,
    effort: optional(Schema.Array(Schema.String)),
    toggle: optional(Schema.Boolean),
    budget: optional(Schema.Struct({ min: optional(Schema.Finite), max: optional(Schema.Finite) })),
  }),
  [json],
)
const Tools = Schema.StructWithRest(Schema.Struct({ supported: Schema.Boolean, updates: optional(Schema.Boolean) }), [
  json,
])
const Capabilities = Schema.StructWithRest(
  Schema.Struct({
    tools: Tools,
    reasoning: Reasoning,
    temperature: optional(Schema.Boolean),
    system_updates: optional(Schema.Boolean),
    effort_updates: optional(Schema.Boolean),
  }),
  [json],
)
const CapabilitiesOverride = Schema.StructWithRest(
  Schema.Struct({
    tools: optional(
      Schema.StructWithRest(Schema.Struct({ ...Tools.schema.fields, supported: optional(Schema.Boolean) }), [json]),
    ),
    reasoning: optional(
      Schema.StructWithRest(Schema.Struct({ ...Reasoning.schema.fields, supported: optional(Schema.Boolean) }), [json]),
    ),
    temperature: optional(Schema.Boolean),
    system_updates: optional(Schema.Boolean),
    effort_updates: optional(Schema.Boolean),
  }),
  [json],
)
const CachePrice = Schema.Struct({
  read: optional(price),
  write: optional(Schema.Union([price, Schema.Record(Schema.String, price)])),
  storage: optional(price),
})
const CacheCost = Schema.Struct({ ...CachePrice.fields, explicit: optional(CachePrice) })
const Api = Schema.Struct({
  base_url: Schema.String,
  sdk: optional(Schema.Struct({ aisdk: optional(Schema.String), opencodeai: optional(Schema.String) })),
  capabilities: optional(CapabilitiesOverride),
  compatibility: optional(json),
})
const Price = Schema.StructWithRest(
  Schema.Struct({
    price,
    unit: optional(Schema.String),
    cache: optional(CacheCost),
    reasoning: optional(price),
    overrides: optional(Schema.Array(json)),
  }),
  [json],
)
const Pricing = Schema.StructWithRest(
  Schema.Struct({
    text: optional(Schema.Struct({ input: optional(Price), output: optional(Price) })),
    image: optional(Schema.Struct({ input: optional(Price), output: optional(Price) })),
    audio: optional(Schema.Struct({ input: optional(Price), output: optional(Price) })),
    video: optional(Schema.Struct({ input: optional(Price), output: optional(Price) })),
    web_search: optional(Price),
    multipliers: optional(Schema.Array(Schema.Json)),
  }),
  [json],
)
const Offering = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.String,
  canonical_id: optional(Schema.String),
  family: optional(Schema.String),
  release_date: Schema.String,
  status: optional(Schema.Literals(["alpha", "beta", "deprecated"])),
  modalities: Schema.Struct({ input: Schema.Array(Schema.String), output: Schema.Array(Schema.String) }),
  capabilities: Capabilities,
  limit: optional(
    Schema.Struct({
      context: optional(Schema.Finite),
      input: optional(Schema.Finite),
      output: optional(Schema.Finite),
    }),
  ),
  api: Schema.Record(Schema.String, Api),
  cost: optional(Pricing),
  experimental: optional(
    Schema.Struct({
      modes: optional(
        Schema.Record(
          Schema.String,
          Schema.Struct({
            cost: optional(Pricing),
            capabilities: optional(CapabilitiesOverride),
            body: optional(json),
            headers: optional(Schema.Record(Schema.String, Schema.String)),
            service_tier: optional(Schema.String),
          }),
        ),
      ),
    }),
  ),
})
const ProviderRecord = Schema.StructWithRest(
  Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    env: Schema.Array(Schema.String),
    models: Schema.Record(Schema.String, Offering),
  }),
  [json],
).check(
  Schema.makeFilter((provider) =>
    provider.npm === undefined ? undefined : "Only models.dev V2 catalogs are supported",
  ),
)
export const Document = Schema.Record(Schema.String, ProviderRecord)

/** Protocol preference is local policy. Unrecognized declarations remain descriptive. */
const protocols = [
  "responses",
  "messages",
  "generate-content",
  "converse",
  "cohere-chat",
  "chat-completions",
  "interactions",
  "workers-ai-run",
]

// Non-native integrations are executable only through these locally trusted adapters.
// A catalog SDK declaration alone never authorizes loading an arbitrary package.
const trustedAdapters: Readonly<Record<string, string>> = {
  gitlab: "gitlab-ai-provider",
  "sap-ai-core": "@jerome-benoit/sap-ai-provider-v2",
  watsonx: "watsonx-ai-provider",
}

export function normalize(provider: typeof ProviderRecord.Type, digest: string): Snapshot[] {
  const models = Object.values(provider.models).flatMap((offering) => {
    const apis = Object.fromEntries(
      Object.entries(offering.api).map(([protocol, entry]) => [
        protocol,
        {
          baseURL: entry.base_url,
          sdk: entry.sdk,
          capabilities: mergeCapabilities(offering.capabilities, entry.capabilities),
          compatibility: entry.compatibility,
        },
      ]),
    )
    const selected = protocols.flatMap((protocol) => {
      const entry = apis[protocol]
      const pkg = entry?.sdk?.opencodeai
      return pkg && Provider.builtin(pkg) ? [{ protocol, entry, pkg }] : []
    })[0]
    const adapter =
      selected ??
      protocols.flatMap((protocol) => {
        const entry = apis[protocol]
        const pkg = entry?.sdk?.aisdk
        return pkg && pkg === trustedAdapters[provider.id] ? [{ protocol, entry, pkg: Provider.aisdk(pkg) }] : []
      })[0]
    const modes = [
      { id: offering.id, name: offering.name, mode: undefined },
      ...Object.entries(offering.experimental?.modes ?? {}).map(([name, mode]) => ({
        id: `${offering.id}-${name}`,
        name: `${offering.name} ${name.charAt(0).toUpperCase()}${name.slice(1)}`,
        mode,
      })),
    ]
    return modes.map(({ id, name, mode }): Model.Info => {
      const capabilities = mergeCapabilities(
        mergeCapabilities(offering.capabilities, adapter?.entry.capabilities),
        mode?.capabilities,
      )
      const rawPricing = mode?.cost
        ? {
            ...offering.cost,
            ...mode.cost,
            ...Object.fromEntries(
              (["text", "image", "audio", "video"] as const).flatMap((key) =>
                offering.cost?.[key] || mode.cost?.[key]
                  ? [[key, { ...offering.cost?.[key], ...mode.cost?.[key] }]]
                  : [],
              ),
            ),
          }
        : offering.cost
      const catalog = {
        format: 2 as const,
        digest,
        protocol: adapter?.protocol,
        apis,
        modalities: offering.modalities,
        rates: rates(rawPricing),
        pricing: rawPricing,
      }
      const compatibility = adapter?.entry.compatibility
      const released = Date.parse(offering.release_date)
      const base: Model.Info = {
        id: Model.ID.make(id),
        modelID: Model.ID.make(offering.id),
        providerID: Provider.ID.make(provider.id),
        name,
        ...(offering.canonical_id ? { canonicalModelID: Model.ID.make(offering.canonical_id) } : {}),
        ...(offering.family ? { family: Model.Family.make(offering.family) } : {}),
        // Only supported chat offerings enter the generative plugin. Media and future APIs remain in the snapshot.
        ...(offering.type !== "chat" || !adapter ? { type: offering.type } : {}),
        package: adapter?.pkg,
        settings: adapter ? { baseURL: adapter.entry.baseURL } : undefined,
        compatibility: {
          ...(typeof compatibility?.reasoning_field === "string"
            ? { reasoningField: compatibility.reasoning_field }
            : {}),
          // replay_reasoning does not require an empty reasoning field on every assistant message.
          ...(compatibility?.max_tokens_field === "max_tokens" ||
          compatibility?.max_tokens_field === "max_completion_tokens"
            ? { maxTokensField: compatibility.max_tokens_field }
            : {}),
          // A declaration that effort is accepted is not evidence of safe cache-preserving updates.
          ...(capabilities.effort_updates === false ? { supportsEffortUpdates: false } : {}),
        },
        capabilities: {
          tools: capabilities.tools.supported,
          reasoning: capabilities.reasoning.supported,
          temperature: capabilities.temperature,
          input: modalities(offering.modalities.input),
          output: modalities(offering.modalities.output),
        },
        catalog,
        variants: [],
        time: { released: Number.isFinite(released) ? released : 0 },
        cost: mode?.service_tier && !mode.cost ? [] : tokenCosts(rawPricing),
        status: offering.status ?? "active",
        enabled:
          adapter !== undefined &&
          offering.type === "chat" &&
          (offering.limit?.context ?? 0) > 0 &&
          (offering.limit?.output ?? 0) > 0,
        // Missing limits are unknown. Zero prevents claiming an invented usable context window.
        limit: {
          context: offering.limit?.context ?? 0,
          input: offering.limit?.input,
          output: offering.limit?.output ?? 0,
        },
        body: mode?.body,
        headers: mode?.headers,
      }
      const supports: Variant.Support[] = capabilities.reasoning.supported
        ? [
            ...(capabilities.reasoning.effort
              ? [{ type: "effort" as const, values: capabilities.reasoning.effort }]
              : []),
            ...(capabilities.reasoning.toggle ? [{ type: "toggle" as const }] : []),
            ...(capabilities.reasoning.budget
              ? [{ type: "budget_tokens" as const, ...capabilities.reasoning.budget }]
              : []),
          ]
        : []
      const variants = Variant.resolve(base, supports)
      return {
        ...base,
        variants,
        ...(variants.length ? { reasoningVariantIDs: variants.map((variant) => variant.id) } : {}),
      }
    })
  })
  const pkg = models.find((model) => model.enabled)?.package
  return [
    {
      info: {
        id: Provider.ID.make(provider.id),
        name: provider.name,
        activation: pkg ? "auto" : "disabled",
        package: pkg ?? "",
      },
      models,
      environment: [...provider.env],
    },
  ]
}

function mergeCapabilities(base: typeof Capabilities.Type, override: typeof CapabilitiesOverride.Type | undefined) {
  return {
    ...base,
    ...override,
    tools: {
      ...(override?.tools?.supported === false ? {} : base.tools),
      ...override?.tools,
      supported: override?.tools?.supported ?? base.tools.supported,
    },
    reasoning: {
      ...(override?.reasoning?.supported === false ? {} : base.reasoning),
      ...override?.reasoning,
      supported: override?.reasoning?.supported ?? base.reasoning.supported,
    },
  }
}

function modalities(values: readonly string[]) {
  return [
    ...new Set(
      values.map((value) => (value === "application/pdf" ? "pdf" : value.includes("/") ? value.split("/")[0]! : value)),
    ),
  ]
}

function rates(cost: typeof Pricing.Type | undefined): NonNullable<Model.Info["catalog"]>["rates"] {
  if (!cost) return []
  const result: NonNullable<Model.Info["catalog"]>["rates"][number][] = (
    ["text", "image", "audio", "video"] as const
  ).flatMap((modality) => {
    const entry = cost[modality]
    return (["input", "output"] as const).flatMap((direction) => {
      const rate = entry?.[direction]
      if (!rate) return []
      const unit = rate.unit ?? "token"
      return [
        {
          modality,
          direction,
          currency: "USD" as const,
          unit,
          per: unit === "token" || unit === "character" ? 1_000_000 : 1,
          price: Money.USD.make(rate.price),
          details: rate,
        },
      ]
    })
  })
  return [
    ...result,
    ...(cost.web_search
      ? [
          {
            modality: "web_search",
            direction: "search" as const,
            currency: "USD" as const,
            unit: "search",
            per: 1_000,
            price: Money.USD.make(cost.web_search.price),
            details: cost.web_search,
          },
        ]
      : []),
  ]
}

/** Only unconditional token prices fit the legacy estimator. All richer rules remain in catalog.pricing. */
function tokenCosts(cost: typeof Pricing.Type | undefined): Model.Info["cost"] {
  const input = cost?.text?.input
  const output = cost?.text?.output
  if (
    !input ||
    !output ||
    cost?.image !== undefined ||
    cost?.audio !== undefined ||
    cost?.video !== undefined ||
    cost?.web_search !== undefined ||
    (input.unit ?? "token") !== "token" ||
    (output.unit ?? "token") !== "token" ||
    input.overrides !== undefined ||
    output.overrides !== undefined ||
    cost?.multipliers?.length
  )
    return []
  if (
    (input.cache?.write !== undefined && typeof input.cache.write !== "number") ||
    input.cache?.explicit ||
    (input.cache?.storage !== undefined && input.cache.storage > 0) ||
    (output.reasoning !== undefined && output.reasoning !== output.price)
  )
    return []
  return [
    {
      input: Money.USDPerMillionTokens.make(input.price),
      output: Money.USDPerMillionTokens.make(output.price),
      cache: {
        read: Money.USDPerMillionTokens.make(input.cache?.read ?? input.price),
        write: Money.USDPerMillionTokens.make(typeof input.cache?.write === "number" ? input.cache.write : input.price),
      },
    },
  ]
}
