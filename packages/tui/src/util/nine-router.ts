export const NINE_ROUTER_ID = "9router"
export const NINE_ROUTER_DEFAULT_URL = "http://127.0.0.1:20128/v1"

/**
 * Mirrors normalizeBaseURL in packages/redcode/src/provider/discovery.ts, so the wizard shows the
 * URL the server will use: a missing scheme becomes http, a trailing /models is dropped and a bare
 * host gets /v1. Returns undefined for anything that is not a plain HTTP(S) URL.
 */
export function normalizeNineRouterURL(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return
  const url = URL.parse(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`)
  if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    return
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/models$/, "") || "/v1"
  return url.toString().replace(/\/+$/, "")
}

/**
 * After the server saved the connection, explains why this project would still not use it.
 * `options` is the provider's options from the merged (project over global) configuration and
 * `providers` the project's enabled providers, both read after the server reloaded.
 */
export function nineRouterConnectionProblem(input: {
  baseURL: string
  options?: { apiKey?: unknown; baseURL?: unknown }
  providers: ReadonlyArray<{ id: string; models: Record<string, unknown> }>
}) {
  const configured = input.options?.baseURL
  if (
    input.options?.apiKey ||
    (typeof configured === "string" &&
      (normalizeNineRouterURL(configured) ?? configured) !== (normalizeNineRouterURL(input.baseURL) ?? input.baseURL))
  ) {
    return "9Router was saved, but an existing provider.options.apiKey or project baseURL overrides this connection. Remove the override from your config to use the saved connection."
  }
  if (!input.providers.some((provider) => provider.id === NINE_ROUTER_ID && Object.keys(provider.models).length)) {
    return "9Router was saved, but no models are enabled in this project. Check enabled_providers, disabled_providers and model filters in your config."
  }
}
