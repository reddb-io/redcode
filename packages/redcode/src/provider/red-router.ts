import { Effect } from "effect"
import { ProviderRouter } from "@reddb-io/redcode-core/provider/router"
import type { HttpClient } from "effect/unstable/http"
import type { Auth } from "@/auth"
import type { Config } from "@/config/config"
import { isRecord } from "@/util/record"
import { ProviderDiscovery } from "./discovery"
import { OpenAICompatible } from "./openai-compatible"

export const PROVIDER_ID = "red-router"
export const NAME = "RedRouter"

/**
 * The provider configuration for a discovery result: RedRouter is an OpenAI-compatible connection
 * with a fixed id and name. See OpenAICompatible.plan for how existing models are treated.
 */
export function plan(existing: Record<string, object | undefined> | undefined, discovered: ProviderDiscovery.Result) {
  const next = OpenAICompatible.plan(existing, discovered.models, { prune: true })
  return {
    provider: {
      npm: OpenAICompatible.DEFAULT_NPM,
      name: NAME,
      options: { baseURL: discovered.baseURL },
      models: next.models,
    },
    remove: next.remove,
  }
}

/**
 * Connects RedRouter through the generic OpenAI-compatible connection with the RedRouter id and
 * name. A key is required and models are always discovered; the router reports context and output
 * limits per model, which discovery stores on each model.
 */
export const connect = Effect.fn("RedRouter.connect")(function* (
  deps: {
    http: HttpClient.HttpClient
    config: Config.Interface
    auth: Auth.Interface
    catalog?: ProviderDiscovery.CatalogLimit
  },
  input: typeof ProviderDiscovery.Input.Type,
) {
  const result = yield* OpenAICompatible.connect(
    deps,
    {
      providerID: PROVIDER_ID,
      name: NAME,
      baseURL: input.baseURL,
      apiKey: input.apiKey,
      npm: OpenAICompatible.DEFAULT_NPM,
    },
    {
      requireKey: true,
      emptyMessage:
        "No models are available. Connect an account or create a combo in the provider dashboard, then retry.",
    },
  ).pipe(Effect.mapError((error) => new ProviderDiscovery.DiscoveryError({ message: error.message })))
  // Probed afresh with the key just saved; it never fails, and an unrecognised router is `none`.
  const router = yield* ProviderRouter.detect({ baseURL: result.baseURL, apiKey: input.apiKey, fresh: true })
  return { baseURL: result.baseURL, models: result.models, router }
})

/**
 * Re-reads the models of a router connection with its saved credential and saves them as a
 * reconnection would: the name, package, headers and credential stay, router fields and limits the
 * router reported follow it, and models it no longer lists that carry nothing but discovery's
 * fields are removed. Only a connection saved in the global configuration file for this very
 * address is refreshed; anything else (a provider declared by hand, or pointed elsewhere by a
 * project file) is left alone and `undefined` is returned.
 */
export const refresh = Effect.fn("RedRouter.refresh")(function* (
  deps: {
    http: HttpClient.HttpClient
    config: Config.Interface
    auth: Auth.Interface
    catalog?: ProviderDiscovery.CatalogLimit
  },
  input: { readonly providerID: string; readonly baseURL: string },
) {
  const file = yield* deps.config.readGlobalFile()
  const baseURL = record(record(record(file.data.provider)[input.providerID]).options).baseURL
  if (typeof baseURL !== "string" || !ProviderRouter.sameEndpoint(baseURL, input.baseURL)) return
  return yield* OpenAICompatible.connect(deps, { providerID: input.providerID, baseURL })
})

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

export * as RedRouter from "./red-router"
