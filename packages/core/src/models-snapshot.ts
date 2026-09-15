export * as ModelsSnapshot from "./models-snapshot"

/**
 * Public catalog endpoints, tried in order after any configured source. models.dev is the
 * upstream project; models.opencode.ai serves the same `api.json` schema.
 */
export const DEFAULT_SOURCES = ["https://models.opencode.ai/api.json", "https://models.dev/api.json"] as const

/**
 * Turns a configured source into a catalog URL. `REDCODE_MODELS_URL` historically named a base
 * URL (`https://models.opencode.ai`) and the client appended `/api.json`; a URL that already
 * names a `.json` document is used as is.
 */
export function normalizeSource(source: string) {
  const trimmed = source.trim().replace(/\/+$/, "")
  if (!trimmed) return undefined
  return /\.json($|[?#])/.test(trimmed) ? trimmed : `${trimmed}/api.json`
}

export function sources(configured: readonly (string | undefined)[]) {
  const result: string[] = []
  for (const item of [...configured, ...DEFAULT_SOURCES]) {
    const url = item === undefined ? undefined : normalizeSource(item)
    if (url && !result.includes(url)) result.push(url)
  }
  return result
}

/**
 * Parses a catalog payload and checks its shape before it may replace a cache or be embedded.
 * The check is deliberately structural (providers with an id and a models map) rather than a
 * full schema decode, so a new upstream field value never makes every fetch look invalid, while
 * a captive-portal page, a proxy block page or a JSON error body is refused.
 */
export function parseCatalog(text: string): Record<string, unknown> | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const entries = Object.entries(value)
  if (entries.length === 0) return undefined
  for (const [, provider] of entries) {
    if (typeof provider !== "object" || provider === null || Array.isArray(provider)) return undefined
    const record = provider as Record<string, unknown>
    if (typeof record.id !== "string") return undefined
    if (typeof record.models !== "object" || record.models === null || Array.isArray(record.models)) return undefined
  }
  return value as Record<string, unknown>
}

export interface LoadOptions {
  /** A local catalog file to embed instead of fetching (`MODELS_DEV_API_JSON`). */
  readonly file?: string
  /** Sources tried before the public defaults (`REDCODE_MODELS_URL`). */
  readonly configured?: readonly (string | undefined)[]
  readonly fetch?: typeof fetch
  readonly attempts?: number
  readonly log?: (message: string) => void
}

/**
 * Loads the catalog embedded into a build as `REDCODE_MODELS_DEV`. Every source is tried in order
 * with retries; a payload that is not a catalog counts as a failure. When nothing yields a
 * catalog the build fails, so a release can never ship with an empty or garbage snapshot.
 */
export async function loadForBuild(options: LoadOptions = {}): Promise<string> {
  const log = options.log ?? ((message: string) => console.log(message))
  if (options.file) {
    const text = await Bun.file(options.file).text()
    if (!parseCatalog(text)) throw new Error(`MODELS_DEV_API_JSON (${options.file}) is not a models catalog`)
    log(`Loaded models catalog snapshot from ${options.file}`)
    return text
  }
  const doFetch = options.fetch ?? fetch
  const attempts = options.attempts ?? 3
  const failures: string[] = []
  for (const url of sources(options.configured ?? [])) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const failure = await doFetch(url, { signal: AbortSignal.timeout(60_000) })
        .then(async (response) => {
          if (!response.ok) return `HTTP ${response.status}`
          const text = await response.text()
          if (!parseCatalog(text)) return "response is not a models catalog"
          return { text }
        })
        .catch((error: unknown) => (error instanceof Error ? error.message : String(error)))
      if (typeof failure !== "string") {
        log(`Loaded models catalog snapshot from ${url}`)
        return failure.text
      }
      failures.push(`${url} (attempt ${attempt}): ${failure}`)
      if (attempt < attempts) await Bun.sleep(1000 * attempt)
    }
  }
  throw new Error(`Could not load a models catalog snapshot for the build:\n${failures.join("\n")}`)
}
