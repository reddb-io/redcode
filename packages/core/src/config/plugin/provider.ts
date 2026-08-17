export * as ConfigProviderPlugin from "./provider"

import { define } from "../../plugin/internal"
import { Effect } from "effect"
import { Config } from "../../config"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"

export const Plugin = define({
  id: "config-provider",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    yield* ctx.integration.transform(
      Effect.fn(function* (integrations) {
        const files = (yield* config.entries()).filter((entry): entry is Config.Document => entry.type === "document")
        const configuredIntegrations = new Set(
          files.flatMap((file) =>
            Object.entries(file.info.providers ?? {}).flatMap(([id, provider]) =>
              provider.env === undefined ? [] : [id],
            ),
          ),
        )
        for (const file of files) {
          for (const [id, item] of Object.entries(file.info.providers ?? {})) {
            const integrationID = id
            if (!configuredIntegrations.has(id) && !integrations.get(integrationID)) continue
            integrations.update(integrationID, (integration) => {
              integration.name = item.name ?? integration.name
            })
            if (item.env !== undefined) {
              integrations.method.update({
                integrationID,
                method: { type: "env", names: [...item.env] },
              })
            }
          }
        }
      }),
    )

    yield* ctx.catalog.transform(
      Effect.fn(function* (catalog) {
        const entries = yield* config.entries()
        const files = entries.filter((entry): entry is Config.Document => entry.type === "document")
        const configuredDefault = Config.latest(entries, "model")
        if (configuredDefault !== undefined) {
          const model = ModelV2.parse(configuredDefault)
          catalog.model.default.set(model.providerID, model.modelID)
        }
        // Collected across every file so the check runs against the api a later file may still replace.
        const requested = new Map<string, string>()
        for (const file of files) {
          for (const [id, item] of Object.entries(file.info.providers ?? {})) {
            const providerID = id
            if (item.npm !== undefined) requested.set(providerID, item.npm)
            catalog.provider.update(providerID, (provider) => {
              if (item.name !== undefined) provider.name = item.name
              if (item.api !== undefined) provider.api = { ...item.api }
              if (item.request !== undefined) {
                Object.assign(provider.request.headers, item.request.headers)
                Object.assign(provider.request.body, item.request.body)
              }
            })
            for (const [id, config] of Object.entries(item.models ?? {})) {
              catalog.model.update(providerID, id, (model) => {
                if (config.family !== undefined) model.family = config.family
                if (config.name !== undefined) model.name = config.name
                if (config.api !== undefined) model.api = { ...model.api, ...config.api }
                if (config.capabilities !== undefined) {
                  model.capabilities = {
                    tools: config.capabilities.tools,
                    input: [...config.capabilities.input],
                    output: [...config.capabilities.output],
                  }
                }
                if (config.request !== undefined) {
                  Object.assign(model.request.headers, config.request.headers)
                  Object.assign(model.request.body, config.request.body)
                  if (config.request.variant !== undefined) model.request.variant = config.request.variant
                }
                if (config.variants !== undefined) {
                  for (const variant of config.variants) {
                    let existing = model.variants.find((item) => item.id === variant.id)
                    if (!existing) {
                      existing = {
                        id: variant.id,
                        headers: {},
                        body: {},
                      }
                      model.variants.push(existing)
                    }
                    Object.assign(existing.headers, variant.headers)
                    Object.assign(existing.body, variant.body)
                  }
                }
                if (config.cost !== undefined) {
                  model.cost = (Array.isArray(config.cost) ? config.cost : [config.cost]).map((cost) => ({
                    tier: cost.tier && { ...cost.tier },
                    input: cost.input,
                    output: cost.output,
                    cache: {
                      read: cost.cache?.read ?? 0,
                      write: cost.cache?.write ?? 0,
                    },
                  }))
                }
                if (config.disabled !== undefined) model.enabled = !config.disabled
                if (config.limit !== undefined) model.limit = { ...model.limit, ...config.limit }
              })
            }
          }
        }
        for (const [providerID, npm] of requested) {
          const conflict = describeConflict(providerID, npm, catalog.provider.get(providerID)?.provider.api)
          if (conflict) return yield* Effect.die(conflict)
        }
      }),
    )
  }),
})

/**
 * A provider block may override the endpoint through `api.url` or `request.body.baseURL`, but `npm`
 * only names a package the catalog already chose. Honouring one half while dropping the other builds
 * an endpoint neither source describes, so a disagreement is reported instead of resolved.
 */
function describeConflict(providerID: string, npm: string, api: ProviderV2.Api | undefined) {
  const resolved = api?.type === "aisdk" ? api.package : undefined
  if (resolved === npm) return
  const url = api?.url ?? "the package default endpoint"
  return [
    `Provider "${providerID}" cannot be resolved: config asks for npm "${npm}"`,
    resolved === undefined
      ? `but the provider resolves to a ${api?.type ?? "missing"} api with no package,`
      : `but the resolved package is "${resolved}",`,
    `so requests would go to ${url} using the wrong protocol.`,
    `Set providers.${providerID}.api to { "type": "aisdk", "package": "${npm}", "url": "<endpoint>" } so the package`,
    `and the URL come from the same source, or remove providers.${providerID}.npm to keep the catalog defaults.`,
  ].join(" ")
}
