import { Effect } from "effect"
import type { HttpClient } from "effect/unstable/http"
import { Auth } from "@/auth"
import type { Config } from "@/config/config"
import { ProviderDiscovery } from "./discovery"

export const PROVIDER_ID = "9router"

/** The only fields discovery writes on a model. A model with any other field was customized. */
const DISCOVERY_FIELDS = new Set(["name", "limit"])

type ModelPatch = { name?: string; limit?: ProviderDiscovery.Limit }

/**
 * Computes the global config change for a discovery result. New models get their name and limits.
 * Existing models are left alone, except that one without limits gets them (a zero context would
 * disable proactive compaction). Models that are no longer listed are removed only when they carry
 * nothing but discovery's own fields; customized models are kept.
 */
export function plan(existing: Record<string, object | undefined> | undefined, discovered: ProviderDiscovery.Result) {
  const current: Record<string, object | undefined> = existing ?? {}
  const found = new Set(discovered.models.map((model) => model.id))
  const models: Record<string, ModelPatch> = {}
  for (const model of discovered.models) {
    const entry = Object.hasOwn(current, model.id) ? current[model.id] : undefined
    if (!entry) models[model.id] = { name: model.name, limit: { ...model.limit } }
    else models[model.id] = "limit" in entry && entry.limit ? {} : { limit: { ...model.limit } }
  }
  const remove = Object.entries(current)
    .filter(([id, entry]) => !found.has(id) && Object.keys(entry ?? {}).every((key) => DISCOVERY_FIELDS.has(key)))
    .map(([id]) => id)
  return {
    provider: {
      npm: "@ai-sdk/openai-compatible",
      name: "9Router",
      options: { baseURL: discovered.baseURL },
      models,
    },
    remove,
  }
}

/**
 * Discovers the router's models and saves the connection: provider configuration first, then the
 * key in the credential store (never in configuration). Once discovery succeeds both writes run
 * uninterruptibly, so a cancelled request never leaves a credential without its provider.
 */
export const connect = Effect.fn("NineRouter.connect")(function* (
  deps: {
    http: HttpClient.HttpClient
    config: Config.Interface
    auth: Auth.Interface
    catalog?: ProviderDiscovery.CatalogLimit
  },
  input: typeof ProviderDiscovery.Input.Type,
) {
  const discovered = yield* ProviderDiscovery.discover(deps.http, input, { catalog: deps.catalog })
  const global = yield* deps.config.getGlobal()
  const next = plan(global.provider?.[PROVIDER_ID]?.models, discovered)
  yield* Effect.uninterruptible(
    Effect.gen(function* () {
      yield* deps.config.updateGlobal(
        { provider: { [PROVIDER_ID]: next.provider } },
        { remove: next.remove.map((id) => ["provider", PROVIDER_ID, "models", id]) },
      )
      yield* deps.auth.set(PROVIDER_ID, new Auth.Api({ type: "api", key: input.apiKey.trim() })).pipe(Effect.orDie)
    }),
  )
  return discovered
})

export * as NineRouter from "./nine-router"
