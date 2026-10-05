export * as ConfigProviderPlugin from "./provider.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Document, type Entry } from "@opencode/schema/config"
import { ConfigProvider } from "@opencode/schema/config/provider"
import { Money } from "@opencode/schema/money"
import { Effect, Stream } from "effect"
import { Bus } from "../../bus.js"
import { Config } from "../../config.js"
import { Model } from "../../model.js"
import { ModelsDev } from "../../models-dev.js"
import {
  catalogLimits,
  knownLimit,
  undescribedLimit,
  type CatalogLimits,
} from "../../plugin/provider/catalog-limits.js"
import { Provider } from "../../provider.js"
import { Variant } from "../../variant.js"
import { ConfigModelReasoningV1 } from "../../v1/config/model-reasoning.js"
import { ConfigEntryObserver } from "./entry-observer.js"

/** Generic OpenAI-compatible endpoints: nothing but their `/models`, the configuration and the catalog describes a model. */
const GENERIC_PACKAGES = new Set([
  "@opencode/ai/providers/openai-compatible",
  "@opencode/ai/providers/openai-compatible-responses",
])

export const Plugin = define({
  id: "opencode.config.provider",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const modelsDev = yield* ModelsDev.Service
    const bus = yield* Bus.Service
    // A configured model that no catalog or discovery describes takes its limits from the current models catalog on
    // every fold, so a model the catalog learns later is not stuck with a guess (see `undescribedLimit`).
    const catalog = { limits: catalogLimits(yield* modelsDev.get()) }
    // Evaluated after `loaded` exists: the observer only runs it on later configuration updates.
    const warnWithoutCatalog: Effect.Effect<void> = Effect.suspend(() => {
      const undescribed = configuredProviders(loaded.entries).flatMap(([id, provider]) =>
        Object.entries(provider.models ?? {}).flatMap(([modelID, model]) =>
          authoredLimit(model.limit).context === undefined ? [`${id}/${modelID}`] : [],
        ),
      )
      if (catalog.limits.size > 0 || undescribed.length === 0) return Effect.void
      return Effect.logWarning(
        "The models catalog is empty, so configured models without a limit of their own are guessed until it loads",
        { models: undescribed.slice(0, 20), count: undescribed.length },
      )
    })
    const loaded = yield* ConfigEntryObserver.observe(
      config,
      ctx.event,
      warnWithoutCatalog.pipe(Effect.andThen(ctx.integration.reload()), Effect.andThen(ctx.provider.reload())),
    )
    yield* warnWithoutCatalog
    yield* bus.subscribe(ModelsDev.Event.Refreshed).pipe(
      Stream.runForEach(() =>
        modelsDev.get().pipe(
          Effect.tap((data) => Effect.sync(() => (catalog.limits = catalogLimits(data)))),
          Effect.andThen(warnWithoutCatalog),
          Effect.andThen(ctx.model.reload()),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* ctx.integration.transform((integrations) => {
      for (const [id, provider] of configuredProviders(loaded.entries)) {
        const integrationID = id
        if (!integrations.get(integrationID)) {
          integrations.method.update({
            integrationID,
            method: { type: "key", label: "Manually enter API Key" },
          })
        }
        integrations.update(integrationID, (integration) => {
          integration.name = provider.name ?? integration.name
        })
        if (provider.env !== undefined) {
          integrations.method.update({
            integrationID,
            method: { type: "env", names: [...provider.env] },
          })
        }
      }
    })

    const sources = {
      defaultModel: undefined as Document["info"]["model"],
      models: new Map<
        ConfigProvider.Info,
        {
          readonly providerID: string
          /** Whether the configuration declares a generic OpenAI-compatible endpoint for this provider. */
          readonly generic: boolean
          readonly models: ReadonlyMap<
            string,
            { readonly inherit: boolean; readonly base?: Model.Info; readonly described: boolean }
          >
        }
      >(),
    }
    yield* ctx.provider.transform((providers) => {
      const next: typeof sources.models = new Map()
      // Models that configuration alone brought into being: no catalog, discovery or canonical provider describes
      // them, so their limits are resolved in the model fold below.
      const undescribed = new Set<string>()
      const packages = new Map<string, string | undefined>()
      for (const [id, item] of configuredProviders(loaded.entries)) {
        const providerID = id
        const current = providers.get(providerID)
        const sourceID = item.canonical ?? current?.provider.canonical ?? providerID
        const source = providers.get(sourceID)
        const changed = item.canonical !== undefined && item.canonical !== current?.provider.canonical
        const declaredPackage = item.package ?? packages.get(providerID)
        packages.set(providerID, declaredPackage)
        providers.update(providerID, (provider) => {
          if (changed && source && source.provider !== provider)
            Object.assign(provider, structuredClone(source.provider), {
              id: provider.id,
              integrationID: provider.integrationID,
            })
          provider.activation = "enabled"
          if (item.canonical !== undefined) provider.canonical = item.canonical
          if (item.name !== undefined) provider.name = item.name
          if (item.package !== undefined) provider.package = item.package
          if (item.settings !== undefined) provider.settings = Provider.mergeOverlay(provider.settings, item.settings)
          if (item.headers !== undefined) provider.headers = Provider.mergeHeaders(provider.headers, item.headers)
          if (item.body !== undefined) provider.body = Provider.mergeOverlay(provider.body, item.body)
        })
        const definitions = new Map<
          string,
          { readonly inherit: boolean; readonly base?: Model.Info; readonly described: boolean }
        >()
        for (const [id, config] of Object.entries(item.models ?? {})) {
          const baseID = source?.models.has(config.modelID ?? id) ? (config.modelID ?? id) : id
          const base = source?.models.get(baseID)
          const inherit = changed || !current?.models.has(id)
          const described = base !== undefined && !undescribed.has(`${sourceID}/${baseID}`)
          if (described) undescribed.delete(`${providerID}/${id}`)
          else undescribed.add(`${providerID}/${id}`)
          // Bind the source at this point in the provider fold. Later source edits/removal
          // and its credential availability must not change an already-defined alias.
          definitions.set(id, { inherit, base: base && structuredClone(base), described })
          if (!inherit) continue
          providers.models.update(providerID, id, (model) => {
            if (base) Object.assign(model, structuredClone(base))
            if (item.package !== undefined) model.package = undefined
            if (item.settings?.baseURL !== undefined && model.settings) delete model.settings.baseURL
          })
        }
        next.set(item, { providerID, generic: GENERIC_PACKAGES.has(declaredPackage ?? ""), models: definitions })
      }
      sources.defaultModel = Config.latest(loaded.entries, "model")
      sources.models = next
    })

    // Keep explicit model overrides in their late registration position, after external
    // model transforms. They can recreate or re-enable a model within an available provider.
    yield* ctx.model.transform((models) => {
      const configuredDefault = sources.defaultModel
      if (configuredDefault !== undefined) models.default.set(configuredDefault.providerID, configuredDefault.model)
      const filters = new Map<string, { include?: readonly string[]; exclude?: readonly string[] }>()
      // What every configuration document so far declares for a model, so a later document's partial limit
      // completes an earlier one instead of resolving it again.
      const authored = new Map<string, Authored>()
      for (const [item, definition] of sources.models) {
        const providerID = definition.providerID
        if (item.includeModels !== undefined || item.excludeModels !== undefined) {
          const previous = filters.get(providerID)
          filters.set(providerID, {
            include: item.includeModels ?? previous?.include,
            exclude: item.excludeModels ?? previous?.exclude,
          })
        }
        for (const [id, config] of Object.entries(item.models ?? {})) {
          const source = definition.models.get(id)
          const inherit = source?.inherit || !models.get(providerID, id)
          const declared = { ...authored.get(`${providerID}/${id}`), ...authoredLimit(config.limit) }
          authored.set(`${providerID}/${id}`, declared)
          models.update(providerID, id, (model) => {
            if (inherit && source?.base) {
              Object.assign(model, structuredClone(source.base))
              if (item.package !== undefined) model.package = undefined
              if (item.settings?.baseURL !== undefined && model.settings) delete model.settings.baseURL
            }
            if (config.family !== undefined) model.family = config.family
            if (config.name !== undefined) model.name = config.name
            if (config.modelID !== undefined) model.modelID = config.modelID
            if (config.compatibility !== undefined)
              model.compatibility = { ...model.compatibility, ...config.compatibility }
            if (config.package !== undefined) model.package = config.package
            if (config.settings !== undefined) model.settings = Provider.mergeOverlay(model.settings, config.settings)
            if (config.headers !== undefined) model.headers = Provider.mergeHeaders(model.headers, config.headers)
            if (config.body !== undefined) model.body = Provider.mergeOverlay(model.body, config.body)
            if (config.capabilities !== undefined)
              model.capabilities = Model.overlayCapabilities(model.capabilities, config.capabilities)
            const resolved =
              source && !source.described
                ? resolveLimit(declared, catalog.limits, [model.modelID, id], definition.generic)
                : undefined
            if (resolved) model.limit = resolved
            else if (config.limit !== undefined) model.limit = { ...model.limit, ...config.limit }
            if (config.capabilities?.reasoning === true) {
              const defaults = ConfigModelReasoningV1.defaults({
                providerID,
                modelID: model.modelID,
                outputLimit: model.limit.output,
                packageName: model.package ?? models.provider.get(providerID)?.provider.package,
                baseURL: model.settings?.baseURL ?? models.provider.get(providerID)?.provider.settings?.baseURL,
                useCompletionUrls:
                  model.settings?.useCompletionUrls ?? models.provider.get(providerID)?.provider.settings?.useCompletionUrls,
              })
              if (defaults) model.settings = Provider.mergeOverlay(defaults.settings, model.settings)
            }
            if (config.cost !== undefined) {
              model.cost = (Array.isArray(config.cost) ? config.cost : [config.cost]).map((cost) => ({
                tier: cost.tier && { ...cost.tier },
                input: cost.input,
                output: cost.output,
                cache: {
                  read: cost.cache?.read ?? Money.USDPerMillionTokens.zero,
                  write: cost.cache?.write ?? Money.USDPerMillionTokens.zero,
                },
              }))
            }
            if (config.disabled !== undefined) model.enabled = !config.disabled
            if (config.time !== undefined) model.time = { ...config.time }
            if (config.status !== undefined) model.status = config.status
            if (config.variants !== undefined) {
              // V1 variant overrides merged into generated defaults before disabled IDs were removed.
              if (inherit && !source?.base) {
                const generated = Variant.resolve({
                  ...model,
                  package: model.package ?? models.provider.get(providerID)?.provider.package,
                })
                model.variants = [...generated]
                if (generated.length) model.reasoningVariantIDs = generated.map((variant) => variant.id)
              }
              for (const variant of config.variants) {
                if (variant.disabled) {
                  model.variants = model.variants.filter((item) => item.id !== variant.id)
                  if (model.reasoningVariantIDs) {
                    model.reasoningVariantIDs = model.reasoningVariantIDs.filter((id) => id !== variant.id)
                    if (model.reasoningVariantIDs.length === 0) delete model.reasoningVariantIDs
                  }
                  continue
                }
                let existing = model.variants.find((item) => item.id === variant.id)
                if (!existing) {
                  existing = { id: variant.id }
                  model.variants.push(existing)
                }
                if (variant.settings !== undefined)
                  existing.settings = Provider.mergeOverlay(existing.settings, variant.settings)
                if (variant.headers !== undefined)
                  existing.headers = Provider.mergeHeaders(existing.headers, variant.headers)
                if (variant.body !== undefined) existing.body = Provider.mergeOverlay(existing.body, variant.body)
              }
            }
          })
          if (config.variants === undefined && !source?.base)
            models.update(providerID, id, (model) => {
              const generated = Variant.resolve({
                ...model,
                package: model.package ?? models.provider.get(providerID)?.provider.package,
              })
              model.variants = [...generated]
              if (generated.length) model.reasoningVariantIDs = generated.map((variant) => variant.id)
            })
          const reasoning = config.capabilities?.reasoning
          if (reasoning !== undefined)
            models.update(providerID, id, (model) => {
              const reconciled = Variant.reconcile(
                { ...model, package: model.package ?? models.provider.get(providerID)?.provider.package },
                reasoning,
                config.variants,
              )
              model.variants = [...reconciled.variants]
              if (reconciled.ids.length) model.reasoningVariantIDs = [...reconciled.ids]
              else delete model.reasoningVariantIDs
            })
        }
      }
      // Filter after explicit model overlays so a denied catalog ID cannot be recreated as an alias.
      for (const [providerID, filter] of filters) {
        const include = filter.include && new Set(filter.include)
        const exclude = filter.exclude && new Set(filter.exclude)
        models.list(providerID).forEach((model) => {
          if ((include && !include.has(model.id)) || exclude?.has(model.id)) models.remove(providerID, model.id)
        })
      }
    })
  }),
})

function configuredProviders(entries: readonly Entry[]) {
  return entries
    .filter((entry): entry is Document => entry.type === "document")
    .flatMap((file) => Object.entries(file.info.providers ?? {}))
}

type Authored = { readonly context?: number; readonly input?: number; readonly output?: number }

/**
 * What the configuration declares for a model, without the guess an older wizard froze into it: a guess was never a
 * fact, so it is resolved again. The output written beside a guessed context was the default or the guess itself
 * unless the endpoint reported it.
 */
function authoredLimit(limit: Authored | undefined): Authored {
  if (!limit) return {}
  const frozen = limit.context === undescribedLimit.context
  const guessedOutput = frozen && (limit.output === undescribedLimit.output || limit.output === limit.context)
  return {
    ...(limit.context === undefined || frozen ? {} : { context: limit.context }),
    ...(limit.input === undefined ? {} : { input: limit.input }),
    ...(limit.output === undefined || guessedOutput ? {} : { output: limit.output }),
  }
}

/**
 * The limits of a model that configuration alone defines: its own numbers first, then what the catalog knows under
 * its ids, then the guess on a generic OpenAI-compatible endpoint. Elsewhere a model the catalog does not know
 * keeps its defaults, so nothing is returned.
 */
function resolveLimit(
  declared: Authored,
  limits: CatalogLimits,
  ids: readonly string[],
  generic: boolean,
): Model.Info["limit"] | undefined {
  const known =
    declared.context !== undefined && declared.output !== undefined
      ? undefined
      : ids.map((id) => knownLimit(limits, id)).find((entry) => entry !== undefined)
  const fallback = known ?? (generic ? undescribedLimit : undefined)
  if (!fallback) return undefined
  const context = declared.context ?? fallback.context
  return {
    context,
    ...(declared.input === undefined ? {} : { input: declared.input }),
    output: declared.output ?? Math.min(fallback.output, context),
  }
}
