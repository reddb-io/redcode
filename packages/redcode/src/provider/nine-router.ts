import { Effect } from "effect"
import { ProviderRouter } from "@reddb-io/redcode-core/provider/router"
import type { HttpClient } from "effect/unstable/http"
import type { Auth } from "@/auth"
import type { Config } from "@/config/config"
import { ProviderDiscovery } from "./discovery"
import { OpenAICompatible } from "./openai-compatible"

export const PROVIDER_ID = "9router"
export const NAME = "9Router"

/**
 * The provider configuration for a discovery result: 9Router is an OpenAI-compatible connection
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
 * Connects 9Router through the generic OpenAI-compatible connection with the 9Router id and name.
 * A key is required and models are always discovered.
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
      detect: true,
    },
  ).pipe(Effect.mapError((error) => new ProviderDiscovery.DiscoveryError({ message: error.message })))
  // Probed afresh by the connection with the key just saved, so this reads the cached result.
  const router = yield* ProviderRouter.detect({ baseURL: result.baseURL, apiKey: input.apiKey })
  return { baseURL: result.baseURL, models: result.models, router }
})

export * as NineRouter from "./nine-router"
