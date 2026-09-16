export const NINE_ROUTER_ID = "9router"
export const NINE_ROUTER_NAME = "9Router"
export const NINE_ROUTER_DEFAULT_URL = "http://127.0.0.1:20128/v1"
export const DEFAULT_PROVIDER_ID = "openai-compatible"
export const COMPATIBLE_NPM = ["@ai-sdk/openai-compatible", "@ai-sdk/openai"] as const
export type CompatibleNpm = (typeof COMPATIBLE_NPM)[number]

const PROVIDER_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
const ENV_REFERENCE = /^\{env:[A-Za-z_][A-Za-z0-9_]*\}$/

/** Mirrors isLocalHost in packages/redcode/src/provider/discovery.ts. */
export function isLocalHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true
  if (host.includes(":")) return host === "::1" || /^f[cd][0-9a-f]{2}:/.test(host)
  const ip = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host)
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])]
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  return !host.includes(".")
}

/**
 * Mirrors normalizeBaseURL in packages/redcode/src/provider/discovery.ts, so the wizard shows the
 * URL the server will use: a missing scheme becomes http for a local host and https otherwise, a
 * trailing /models is dropped and a bare host gets /v1. Returns undefined for anything that is not
 * a plain HTTP(S) URL.
 */
export function normalizeBaseURL(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return
  const schemeless = !/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
  const probe = schemeless ? URL.parse(`http://${trimmed}`) : undefined
  const url = URL.parse(
    schemeless ? `${probe && !isLocalHost(probe.hostname) ? "https" : "http"}://${trimmed}` : trimmed,
  )
  if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    return
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/models$/, "") || "/v1"
  return url.toString().replace(/\/+$/, "")
}

/** Mirrors the server's provider id rule. A pasted `@ai-sdk/` prefix is dropped. */
export function normalizeProviderID(value: string) {
  const providerID = value.trim().replace(/^@ai-sdk\//, "")
  if (!PROVIDER_ID.test(providerID)) return
  return providerID
}

/** True for the addresses 9Router listens on by default, where a `9router` provider belongs. */
export function isNineRouterDefaultURL(baseURL: string) {
  const url = URL.parse(normalizeBaseURL(baseURL) ?? "")
  return !!url && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && url.port === "20128"
}

/**
 * Suggests a provider id from the API URL: the registrable name of the host (`api.together.xyz`
 * becomes `together`), or `openai-compatible` for local and numeric addresses.
 */
export function suggestProviderID(baseURL: string, taken: (id: string) => boolean = () => false) {
  const host = URL.parse(normalizeBaseURL(baseURL) ?? "")?.hostname ?? ""
  const labels = host.split(".").filter(Boolean)
  const local = !host || host === "localhost" || host.startsWith("[") || /^[\d.]+$/.test(host) || labels.length < 2
  const base = normalizeProviderID(
    (local ? DEFAULT_PROVIDER_ID : labels[labels.length - 2]).toLowerCase().replace(/[^a-z0-9_-]/g, "-"),
  )
  const id = base ?? DEFAULT_PROVIDER_ID
  if (!taken(id)) return id
  for (let n = 2; ; n++) if (!taken(`${id}-${n}`)) return `${id}-${n}`
}

/** A display name for an id: `my-gateway` becomes `My Gateway`. */
export function suggestName(providerID: string) {
  return providerID
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ")
}

export function isEnvReference(value: string) {
  return ENV_REFERENCE.test(value.trim())
}

/** Checks a typed key before it is sent. Returns an error message, or undefined when it is usable. */
export function keyProblem(value: string) {
  const key = value.trim()
  if (!key || isEnvReference(key)) return
  if (key.includes("{env:")) return "Use an environment reference on its own, such as {env:MY_PROVIDER_KEY}."
  if (!/^[\x21-\x7e]+$/.test(key)) return "The API key contains invalid characters. Copy it again from the dashboard."
}

export type ManualModel = { id: string; context?: number }

function tokens(value: string) {
  const match = /^(\d+(?:\.\d+)?)([km])?$/i.exec(value)
  if (!match) return
  const scale = { k: 1_000, m: 1_000_000 }[match[2]?.toLowerCase() ?? ""] ?? 1
  const count = Math.round(Number(match[1]) * scale)
  return Number.isSafeInteger(count) && count > 0 ? count : undefined
}

/**
 * Parses models typed by hand: comma or newline separated, each a model id optionally followed by
 * its context size (`llama3.1:8b 128k, qwen2.5-coder`).
 */
export function parseManualModels(text: string): { models: ManualModel[] } | { error: string } {
  const models = new Map<string, ManualModel>()
  for (const entry of text.split(/[,，、\n]/).map((item) => item.trim())) {
    if (!entry) continue
    const [id, context, ...rest] = entry.split(/\s+/)
    if (rest.length || ["__proto__", "constructor", "prototype"].includes(id))
      return { error: `"${entry}" is not a model id and optional context size.` }
    if (context === undefined) {
      models.set(id, { id })
      continue
    }
    const size = tokens(context)
    if (!size) return { error: `"${context}" is not a context size. Use a number of tokens such as 128000 or 128k.` }
    models.set(id, { id, context: size })
  }
  if (!models.size) return { error: "Enter at least one model id." }
  return { models: [...models.values()] }
}

/**
 * After the server saved the connection, explains why this project would still not use it.
 * `options` is the provider's options from the merged (project over global) configuration and
 * `providers` the project's enabled providers, both read after the server reloaded. An apiKey in
 * options is only an override when the server stored the key in the credential store.
 */
export function connectionProblem(input: {
  providerID: string
  name: string
  baseURL: string
  credential?: "stored" | "reference" | "kept" | "none"
  options?: { apiKey?: unknown; baseURL?: unknown }
  providers: ReadonlyArray<{ id: string; models: Record<string, unknown> }>
}) {
  const configured = input.options?.baseURL
  if (
    (["stored", "none"].includes(input.credential ?? "stored") && input.options?.apiKey) ||
    (typeof configured === "string" &&
      (normalizeBaseURL(configured) ?? configured) !== (normalizeBaseURL(input.baseURL) ?? input.baseURL))
  ) {
    return `${input.name} was saved, but an existing provider.options.apiKey or project baseURL overrides this connection. Remove the override from your config to use the saved connection.`
  }
  if (!input.providers.some((provider) => provider.id === input.providerID && Object.keys(provider.models).length)) {
    return `${input.name} was saved, but no models are enabled in this project. Check enabled_providers, disabled_providers and model filters in your config.`
  }
}
