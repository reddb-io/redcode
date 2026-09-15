export * as ModelsSnapshot from "./models-snapshot"

/**
 * Public catalog endpoints, tried in order after any configured source. models.dev is the
 * upstream project; models.opencode.ai serves the same `api.json` schema.
 */
export const DEFAULT_SOURCES = ["https://models.opencode.ai/api.json", "https://models.dev/api.json"] as const

/** Largest catalog body accepted (the public catalog is about 5 MB). */
export const MAX_BYTES = 20 * 1024 * 1024

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export interface Sanitized {
  readonly catalog: Record<string, unknown>
  /** Providers dropped because they lack an `id` or a `models` map. */
  readonly droppedProviders: number
  /** Models dropped from kept providers because they are not objects with an `id`. */
  readonly droppedModels: number
}

/**
 * Keeps the usable part of a catalog: providers with a string `id` and a `models` map, and within
 * them models that are objects with a string `id`. The check is structural rather than a full
 * schema decode, so a new upstream field value never discards a catalog. Returns undefined only
 * when the payload is not a JSON object with at least one usable provider, such as a captive
 * portal page, a proxy block page or a JSON error body.
 */
export function sanitizeCatalog(text: string): Sanitized | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isRecord(value)) return undefined
  const catalog: Record<string, unknown> = {}
  let droppedProviders = 0
  let droppedModels = 0
  for (const [key, provider] of Object.entries(value)) {
    if (!isRecord(provider) || typeof provider.id !== "string" || !isRecord(provider.models)) {
      droppedProviders++
      continue
    }
    const models: Record<string, unknown> = {}
    for (const [modelKey, model] of Object.entries(provider.models)) {
      if (isRecord(model) && typeof model.id === "string") models[modelKey] = model
      else droppedModels++
    }
    catalog[key] = { ...provider, models }
  }
  if (Object.keys(catalog).length === 0) return undefined
  return { catalog, droppedProviders, droppedModels }
}

export function parseCatalog(text: string): Record<string, unknown> | undefined {
  return sanitizeCatalog(text)?.catalog
}

/** The text to store for a sanitized catalog: the original when nothing was dropped. */
export function catalogText(text: string, sanitized: Sanitized) {
  return sanitized.droppedProviders === 0 && sanitized.droppedModels === 0 ? text : JSON.stringify(sanitized.catalog)
}

export interface LoadOptions {
  /** A local catalog file to embed instead of fetching (`MODELS_DEV_API_JSON`). */
  readonly file?: string
  /** Sources tried before the public defaults (`REDCODE_MODELS_URL`). */
  readonly configured?: readonly (string | undefined)[]
  /**
   * When true, a build that cannot load a catalog embeds an empty one with a warning instead of
   * failing. Only for CI verification builds; release builds must leave it false.
   */
  readonly optional?: boolean
  readonly fetch?: typeof fetch
  readonly attempts?: number
  readonly log?: (message: string) => void
}

/**
 * Loads the catalog embedded into a build as `REDCODE_MODELS_DEV`. A valid `file` wins; otherwise
 * every source is tried in order with retries, and a payload that is not a catalog or exceeds
 * MAX_BYTES counts as a failure. When nothing yields a catalog the build fails, so a release can
 * never ship with an empty or garbage snapshot, unless `optional` is set.
 */
export async function loadForBuild(options: LoadOptions = {}): Promise<string> {
  const log = options.log ?? ((message: string) => console.log(message))
  const failures: string[] = []
  if (options.file) {
    const file = Bun.file(options.file)
    const text = (await file.exists()) ? await file.text() : undefined
    const sanitized = text === undefined ? undefined : sanitizeCatalog(text)
    if (text !== undefined && sanitized) {
      log(`Loaded models catalog snapshot from ${options.file}`)
      return catalogText(text, sanitized)
    }
    if (!options.optional) throw new Error(`MODELS_DEV_API_JSON (${options.file}) is not a models catalog`)
    failures.push(`${options.file}: ${text === undefined ? "missing" : "not a models catalog"}`)
  }
  const doFetch = options.fetch ?? fetch
  const attempts = options.attempts ?? 3
  for (const url of sources(options.configured ?? [])) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const outcome = await doFetch(url, { signal: AbortSignal.timeout(60_000) })
        .then(async (response) => {
          if (!response.ok) return `HTTP ${response.status}`
          const body = await response.arrayBuffer()
          if (body.byteLength > MAX_BYTES) return `response larger than ${MAX_BYTES} bytes`
          const text = new TextDecoder().decode(body)
          const sanitized = sanitizeCatalog(text)
          if (!sanitized) return "response is not a models catalog"
          return { text: catalogText(text, sanitized) }
        })
        .catch((error: unknown) => (error instanceof Error ? error.message : String(error)))
      if (typeof outcome !== "string") {
        log(`Loaded models catalog snapshot from ${url}`)
        return outcome.text
      }
      failures.push(`${url} (attempt ${attempt}): ${outcome}`)
      if (attempt < attempts) await Bun.sleep(1000 * attempt)
    }
  }
  const message = `Could not load a models catalog snapshot for the build:\n${failures.join("\n")}`
  if (!options.optional) throw new Error(message)
  log(
    `::warning::${message.replaceAll("\n", " | ")} | Embedding an empty catalog; this build is not releasable (REDCODE_MODELS_SNAPSHOT=optional).`,
  )
  return "{}"
}
