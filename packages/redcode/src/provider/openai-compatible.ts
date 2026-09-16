import { Effect, Schema } from "effect"
import type { HttpClient } from "effect/unstable/http"
import { Auth } from "@/auth"
import type { Config } from "@/config/config"
import { isRecord } from "@/util/record"
import { ProviderDiscovery } from "./discovery"

/** AI SDK packages a connected endpoint may use: chat completions, or the OpenAI Responses API. */
export const NPM_PACKAGES = ["@ai-sdk/openai-compatible", "@ai-sdk/openai"] as const
export const DEFAULT_NPM = NPM_PACKAGES[0]

/** Provider ids are config keys and path segments: lowercase, no dots or slashes. */
export const PROVIDER_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
const ENV_REFERENCE = /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const HEADER_VALUE = /^[\x20-\x7e]*$/
export const MAX_MANUAL_MODELS = 200
export const MAX_HEADERS = 32

export const ManualModel = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  context: Schema.optional(Schema.Finite).annotate({ description: "Context window in tokens, when known." }),
  output: Schema.optional(Schema.Finite).annotate({ description: "Maximum output tokens, when known." }),
})

export const Input = Schema.Struct({
  providerID: Schema.String.annotate({
    description:
      "Id under provider in configuration: lowercase letters, numbers, hyphens and underscores, at most 64 characters.",
  }),
  name: Schema.optional(Schema.String).annotate({
    description: "Display name. Defaults to the configured name, then to the id.",
  }),
  baseURL: Schema.String,
  apiKey: Schema.optional(Schema.String).annotate({
    description:
      "A key for the credential store, or an {env:NAME} reference stored verbatim in configuration. Omit it to keep the saved credential; an empty string removes it.",
  }),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Headers merged into provider.options.headers. Values may use {env:NAME} references.",
  }),
  npm: Schema.optional(Schema.Literals(NPM_PACKAGES)).annotate({
    description: "@ai-sdk/openai-compatible for /chat/completions (default), @ai-sdk/openai for /responses.",
  }),
  override: Schema.optional(Schema.Boolean).annotate({
    description: "Allow an id that belongs to a built-in catalog provider.",
  }),
  models: Schema.optional(Schema.Array(ManualModel)).annotate({
    description:
      "Model ids to save without reading /models. When omitted, models are discovered and the ones discovery added earlier that are no longer listed are removed.",
  }),
  moveFrom: Schema.optional(Schema.String).annotate({
    description:
      "Move an existing provider from the global configuration file to providerID: its settings, models and saved key move, and a default model pointing at it is updated.",
  }),
})
export type Input = typeof Input.Type

export const Credential = Schema.Literals(["stored", "reference", "kept", "none"])
export type Credential = typeof Credential.Type

export const Result = Schema.Struct({
  providerID: Schema.String,
  name: Schema.String,
  baseURL: Schema.String,
  npm: Schema.String,
  models: Schema.Array(ProviderDiscovery.Model),
  discovered: Schema.Boolean.annotate({ description: "False when the models were entered instead of discovered." }),
  credential: Credential.annotate({
    description:
      "stored: the key is in the credential store; reference: an {env:NAME} reference is in configuration; kept: the saved credential was left as it was; none: no key.",
  }),
  configPath: Schema.String.annotate({ description: "The global configuration file that was written." }),
  movedFrom: Schema.optional(Schema.String),
})
export type Result = typeof Result.Type

export const Reason = Schema.Literals([
  "invalid_provider_id",
  "builtin_provider",
  "invalid_url",
  "invalid_key",
  "invalid_headers",
  "invalid_models",
  "invalid_move",
  "discovery",
])
export type Reason = typeof Reason.Type

export class ConnectError extends Schema.TaggedErrorClass<ConnectError>()("ProviderConnectError", {
  reason: Reason,
  message: Schema.String,
}) {}

/** The only fields discovery writes on a model. A model with any other field was customized. */
const DISCOVERY_FIELDS = new Set(["name", "limit"])

type ModelPatch = { name?: string; limit?: ProviderDiscovery.Limit }
type Found = { id: string; name: string; limit: ProviderDiscovery.Limit }

/**
 * Computes the model changes for a connection. New models get their name and limits. Existing
 * models are left alone, except that one without limits gets them (a zero context would disable
 * proactive compaction) and one whose context was typed in gets that limit. With `prune`, models
 * that are no longer listed are removed only when they carry nothing but discovery's own fields;
 * customized models are kept.
 */
export function plan(
  existing: Record<string, unknown> | undefined,
  found: ReadonlyArray<Found>,
  options: { prune: boolean; explicit?: ReadonlySet<string> },
) {
  const current: Record<string, unknown> = existing ?? {}
  const ids = new Set(found.map((model) => model.id))
  const models: Record<string, ModelPatch> = {}
  for (const model of found) {
    const entry = Object.hasOwn(current, model.id) ? current[model.id] : undefined
    if (!isRecord(entry)) models[model.id] = { name: model.name, limit: { ...model.limit } }
    else if (options.explicit?.has(model.id) || !isRecord(entry.limit)) models[model.id] = { limit: { ...model.limit } }
    else models[model.id] = {}
  }
  const remove = options.prune
    ? Object.entries(current)
        .filter(
          ([id, entry]) =>
            !ids.has(id) && Object.keys(isRecord(entry) ? entry : {}).every((key) => DISCOVERY_FIELDS.has(key)),
        )
        .map(([id]) => id)
    : []
  return { models, remove }
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function resolveReferences(value: string, env: (name: string) => string | undefined) {
  return value.replace(/\{env:([^}]+)\}/g, (_, name: string) => env(name) ?? "")
}

/**
 * Validates everything, discovers models (unless they were entered), and saves the connection:
 * provider configuration first, then the credential. Once validation and discovery succeed both
 * writes run uninterruptibly, so a cancelled request never leaves a credential without its provider
 * or a half-moved provider. Nothing is written when any check fails.
 */
export const connect = Effect.fn("OpenAICompatible.connect")(function* (
  deps: {
    http: HttpClient.HttpClient
    config: Config.Interface
    auth: Auth.Interface
    catalog?: ProviderDiscovery.CatalogLimit
    /** True for ids that belong to the built-in provider catalog. */
    builtIn?: (providerID: string) => boolean
    env?: (name: string) => string | undefined
  },
  input: Input,
  options: { requireKey?: boolean; emptyMessage?: string } = {},
) {
  const fail = (reason: Reason, message: string) => new ConnectError({ reason, message })
  const env = deps.env ?? ((name: string) => process.env[name])

  const providerID = input.providerID.trim()
  if (!PROVIDER_ID.test(providerID)) {
    return yield* fail(
      "invalid_provider_id",
      "Use a provider id that starts with a lowercase letter or number and has only lowercase letters, numbers, hyphens and underscores (at most 64 characters).",
    )
  }
  if (!input.override && deps.builtIn?.(providerID)) {
    return yield* fail(
      "builtin_provider",
      `"${providerID}" is a built-in provider. Choose another id, or confirm that this endpoint should override it.`,
    )
  }
  const baseURL = ProviderDiscovery.normalizeBaseURL(input.baseURL)
  if (!baseURL)
    return yield* fail("invalid_url", "Use an HTTP or HTTPS API URL without credentials, query or fragment.")

  const rawKey = input.apiKey?.trim()
  const reference = rawKey ? ENV_REFERENCE.exec(rawKey) : null
  if (rawKey && !reference) {
    if (rawKey.includes("{env:"))
      return yield* fail("invalid_key", "Use an environment reference on its own, such as {env:MY_PROVIDER_KEY}.")
    if (!ProviderDiscovery.validKey(rawKey))
      return yield* fail(
        "invalid_key",
        "The API key contains invalid characters. Copy it again from the provider dashboard.",
      )
  }
  if (options.requireKey && !rawKey)
    return yield* fail("invalid_key", "Enter the API key from your provider dashboard.")

  const headers = input.headers
  if (headers) {
    const entries = Object.entries(headers)
    if (entries.length > MAX_HEADERS) return yield* fail("invalid_headers", `Use at most ${MAX_HEADERS} headers.`)
    for (const [name, value] of entries) {
      if (!HEADER_NAME.test(name) || !HEADER_VALUE.test(value))
        return yield* fail(
          "invalid_headers",
          `The header "${name.slice(0, 64)}" has an invalid name or value. Use printable ASCII without line breaks.`,
        )
    }
  }

  const manual = input.models?.map((model) => ({ ...model, id: model.id.trim() }))
  if (manual) {
    if (manual.length > MAX_MANUAL_MODELS)
      return yield* fail("invalid_models", `Enter at most ${MAX_MANUAL_MODELS} models.`)
    for (const model of manual) {
      if (!ProviderDiscovery.validModelID(model.id) || /\s/.test(model.id))
        return yield* fail("invalid_models", `"${model.id.slice(0, 64)}" is not a valid model id.`)
      for (const value of [model.context, model.output]) {
        if (value !== undefined && !(Number.isSafeInteger(value) && value > 0))
          return yield* fail("invalid_models", `Limits for "${model.id}" must be positive whole numbers of tokens.`)
      }
    }
  }

  const file = yield* deps.config.readGlobalFile()
  const configured = record(file.data.provider)
  const moveFrom = input.moveFrom?.trim()
  if (moveFrom !== undefined) {
    if (!PROVIDER_ID.test(moveFrom) || moveFrom === providerID)
      return yield* fail("invalid_move", "Choose a new provider id that differs from the one being moved.")
    if (!isRecord(configured[moveFrom]))
      return yield* fail("invalid_move", `"${moveFrom}" is not in the global configuration file ${file.path}.`)
    if (Object.hasOwn(configured, providerID))
      return yield* fail("invalid_move", `"${providerID}" already exists. Choose a new id to move the connection to.`)
  }
  const sourceID = moveFrom ?? providerID
  const source = record(configured[sourceID])
  const sourceOptions = record(source.options)
  const savedAuth = yield* deps.auth.get(sourceID).pipe(Effect.orDie)
  const hasSaved = savedAuth !== undefined || sourceOptions.apiKey !== undefined
  const sameEndpoint =
    typeof sourceOptions.baseURL === "string" && ProviderDiscovery.normalizeBaseURL(sourceOptions.baseURL) === baseURL
  // A saved key is only reused for the address it was saved for, never sent somewhere new.
  if (rawKey === undefined && hasSaved && !sameEndpoint) {
    return yield* fail(
      "invalid_key",
      "The API URL changed, so the saved key is not reused. Enter the key for the new address.",
    )
  }

  const discoveryKey = iife(() => {
    if (reference) return env(reference[1])
    if (rawKey) return rawKey
    if (rawKey !== undefined) return undefined
    if (savedAuth?.type === "api") return savedAuth.key
    return typeof sourceOptions.apiKey === "string" ? resolveReferences(sourceOptions.apiKey, env) : undefined
  })

  let found: Array<typeof ProviderDiscovery.Model.Type>
  if (manual === undefined) {
    if (reference && !discoveryKey) {
      return yield* fail(
        "discovery",
        `The environment variable ${reference[1]} is not set on the Redcode server, so models cannot be listed. Set it and retry, or enter model ids.`,
      )
    }
    const discovered = yield* ProviderDiscovery.discover(
      deps.http,
      {
        baseURL,
        apiKey: discoveryKey,
        headers: discoveryHeaders(headers ?? (sameEndpoint ? sourceOptions.headers : undefined), env),
      },
      {
        catalog: deps.catalog,
        requireKey: false,
        emptyMessage: options.emptyMessage ?? "The provider listed no models. Enter model ids instead.",
      },
    ).pipe(Effect.mapError((error) => fail("discovery", error.message)))
    found = [...discovered.models]
  } else {
    found = manual.map((model) => ({
      id: model.id,
      name: model.name?.trim() || model.id,
      ...ProviderDiscovery.resolveLimit(
        { id: model.id, context_length: model.context, max_output_tokens: model.output },
        deps.catalog,
      ),
    }))
  }

  const existingModels = record(source.models)
  if (!found.length && !Object.keys(existingModels).length)
    return yield* fail("invalid_models", "Enter at least one model id.")
  const next = plan(existingModels, found, {
    prune: manual === undefined,
    explicit: new Set((manual ?? []).filter((model) => model.context !== undefined).map((model) => model.id)),
  })

  const name = input.name?.trim() || (typeof source.name === "string" && source.name.trim()) || providerID
  const npm =
    input.npm ??
    (NPM_PACKAGES.find((item) => item === source.npm) as (typeof NPM_PACKAGES)[number] | undefined) ??
    DEFAULT_NPM
  const credential: Credential = reference
    ? "reference"
    : rawKey
      ? "stored"
      : rawKey === undefined && hasSaved
        ? "kept"
        : "none"

  const provider = {
    ...(moveFrom ? source : {}),
    npm,
    name,
    options: {
      ...(moveFrom ? sourceOptions : {}),
      baseURL,
      ...(reference ? { apiKey: rawKey } : {}),
      ...(headers ? { headers: { ...(moveFrom ? record(sourceOptions.headers) : {}), ...headers } } : {}),
    },
    models: moveFrom ? { ...existingModels, ...mergeModels(existingModels, next.models) } : next.models,
  }
  const remove: string[][] = next.remove.map((id) => ["provider", providerID, "models", id])
  if ((credential === "stored" || credential === "none") && sourceOptions.apiKey !== undefined)
    remove.push(["provider", providerID, "options", "apiKey"])
  const patch: Record<string, unknown> = { provider: { [providerID]: provider } }
  if (moveFrom) {
    remove.push(["provider", moveFrom])
    for (const key of ["model", "small_model"]) {
      const value = file.data[key]
      if (typeof value === "string" && value.startsWith(`${moveFrom}/`))
        patch[key] = `${providerID}/${value.slice(moveFrom.length + 1)}`
    }
  }

  yield* Effect.uninterruptible(
    Effect.gen(function* () {
      yield* deps.config.updateGlobal(patch as Parameters<Config.Interface["updateGlobal"]>[0], { remove })
      if (credential === "stored") {
        yield* deps.auth.set(providerID, new Auth.Api({ type: "api", key: rawKey! })).pipe(Effect.orDie)
      } else if (credential === "kept" && moveFrom && savedAuth) {
        yield* deps.auth.set(providerID, savedAuth).pipe(Effect.orDie)
      } else if (credential !== "kept" && savedAuth && !moveFrom) {
        // A reference or an explicit "no key" replaces the stored key, which would otherwise win.
        yield* deps.auth.remove(providerID).pipe(Effect.orDie)
      }
      if (moveFrom && savedAuth) yield* deps.auth.remove(moveFrom).pipe(Effect.orDie)
    }),
  )

  return {
    providerID,
    name,
    baseURL,
    npm,
    models: found,
    discovered: manual === undefined,
    credential,
    configPath: file.path,
    ...(moveFrom ? { movedFrom: moveFrom } : {}),
  } satisfies Result
})

/** Moved models keep every field they had; the plan only adds names and limits on top. */
function mergeModels(existing: Record<string, unknown>, patches: Record<string, ModelPatch>) {
  return Object.fromEntries(Object.entries(patches).map(([id, patch]) => [id, { ...record(existing[id]), ...patch }]))
}

/** Headers for the model list request, with references resolved. Saved headers are only reused for the same address. */
function discoveryHeaders(headers: unknown, env: (name: string) => string | undefined) {
  if (!isRecord(headers)) return
  return Object.fromEntries(
    Object.entries(headers)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && HEADER_NAME.test(entry[0]))
      .map(([name, value]) => [name, resolveReferences(value, env)] as const)
      .filter(([, value]) => HEADER_VALUE.test(value)),
  )
}

function iife<T>(fn: () => T) {
  return fn()
}

export * as OpenAICompatible from "./openai-compatible"
