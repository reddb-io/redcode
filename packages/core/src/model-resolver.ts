export * as ModelResolver from "./model-resolver.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { HttpOptions, LanguageModel, mergeHttpOptions, ProviderConfigurationError } from "@opencode/ai"
import { Auth } from "@opencode/ai/route"
import { Context, Effect, Layer, Option, Schema, Struct } from "effect"
import { AISDK } from "./aisdk.js"
import { Config } from "./config.js"
import { Credential } from "./credential.js"
import { Integration } from "./integration.js"
import { IntegrationConnection } from "./integration/connection.js"
import { Capabilities, ID, Info, Model, Ref, VariantID } from "./model.js"
import type { RuntimeInfo } from "./model.js"
import { ModelsDev } from "./models-dev.js"
import { Npm } from "@opencode/util/npm"
import { Provider } from "./provider.js"
import { KV } from "./kv.js"

export class VariantUnavailableError extends Schema.TaggedError<VariantUnavailableError>()(
  "SessionRunnerModel.VariantUnavailableError",
  {
    providerID: Provider.ID,
    modelID: ID,
    variant: VariantID,
  },
) {
  override get message() {
    return `Variant unavailable for ${this.providerID}/${this.modelID}: ${this.variant}`
  }
}

export class UnsupportedPackageError extends Schema.TaggedError<UnsupportedPackageError>()(
  "SessionRunnerModel.UnsupportedPackageError",
  {
    providerID: Provider.ID,
    modelID: ID,
    package: Schema.String,
  },
) {
  override get message() {
    return `Unsupported package for ${this.providerID}/${this.modelID}: ${this.package}`
  }
}

export const InitializationPhase = Schema.Literals(["load", "init", "construct"])
export type InitializationPhase = typeof InitializationPhase.Type

/** Provider settings are missing, conflicting, or unsupported; the provider's own message tells the user what to fix. */
export class ModelConfigurationError extends Schema.TaggedError<ModelConfigurationError>()(
  "SessionRunnerModel.ModelConfigurationError",
  {
    providerID: Provider.ID,
    modelID: ID,
    package: Schema.String,
    detail: Schema.String,
  },
) {
  override get message() {
    return `Cannot initialize ${this.providerID}/${this.modelID}: ${this.detail}`
  }
}

/** A supported package failed unexpectedly while loading or constructing the model. */
export class ModelInitializationError extends Schema.TaggedError<ModelInitializationError>()(
  "SessionRunnerModel.ModelInitializationError",
  {
    providerID: Provider.ID,
    modelID: ID,
    package: Schema.String,
    phase: InitializationPhase,
    detail: Schema.String,
  },
) {
  override get message() {
    return `Cannot initialize ${this.providerID}/${this.modelID}: ${this.detail}`
  }
}

export class UnresolvedProviderVariablesError extends Schema.TaggedError<UnresolvedProviderVariablesError>()(
  "SessionRunnerModel.UnresolvedProviderVariablesError",
  {
    providerID: Provider.ID,
    modelID: ID,
    variables: Schema.Array(Schema.String),
  },
) {
  override get message() {
    return `Cannot initialize ${this.providerID}/${this.modelID}: ${this.variables.join(", ")} ${this.variables.length === 1 ? "is" : "are"} required to resolve the provider endpoint`
  }
}

export class UnsupportedCompactionError extends Schema.TaggedError<UnsupportedCompactionError>()(
  "SessionRunnerModel.UnsupportedCompactionError",
  {
    providerID: Provider.ID,
    modelID: ID,
    route: Schema.String,
  },
) {
  override get message() {
    return `Provider compaction is not supported by ${this.providerID}/${this.modelID} (${this.route})`
  }
}

export type Error =
  | VariantUnavailableError
  | UnsupportedPackageError
  | ModelConfigurationError
  | ModelInitializationError
  | UnresolvedProviderVariablesError
  | UnsupportedCompactionError
  | Integration.AuthorizationError

export interface Resolved {
  /** Route-level model for provider requests; its id is the provider API model id, which may differ from the catalog id. */
  readonly model: LanguageModel
  /** Selected catalog identity. Durable records and displays must use this, never the API model id. */
  readonly ref: Ref
  /** Catalog capabilities used to shape requests before provider lowering. */
  readonly capabilities: Capabilities
  /** Catalog pricing in dollars per million tokens. */
  readonly cost: Info["cost"]
  /** Catalog token limits used by Core for context management. */
  readonly limit: Info["limit"]
  /** Model policy overrides the provider policy; omitted means summary compaction. */
  readonly compaction?: Provider.Compaction
  /** Provider transport policy; omitted means HTTP. */
  readonly transport?: Provider.Transport
  /** Milliseconds without streamed data before a WebSocket exchange fails; false disables it. */
  readonly chunkTimeout?: number | false
}

export interface Interface {
  readonly resolve: (requested?: Ref) => Effect.Effect<Resolved | undefined, Error>
  readonly resolveModel: (
    model: Info,
    variant?: VariantID,
    connection?: Ref["connection"],
  ) => Effect.Effect<Resolved, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ModelResolver") {}

// Variant resolution adds request-local overlays without changing the committed model snapshot.
export const withVariant = (
  model: Info,
  variantID: VariantID | undefined,
): Effect.Effect<Info, VariantUnavailableError> => {
  const id = variantID === "default" ? undefined : variantID
  const variant = model.variants?.find((item) => item.id === id)
  if (!variant && id !== undefined)
    return Effect.fail(
      new VariantUnavailableError({
        providerID: model.providerID,
        modelID: model.id,
        variant: id,
      }),
    )
  return Effect.succeed(
    variant
      ? {
          ...model,
          settings: Provider.mergeOverlay(model.settings, Provider.modelSettings(variant.settings)),
          headers: Provider.mergeHeaders(model.headers, variant.headers),
          body: Provider.mergeOverlay(model.body, variant.body),
        }
      : model,
  )
}

export interface Dependencies {
  readonly loadPackage?: (specifier: string) => Effect.Effect<Provider.ProviderPackage, Provider.LoadError>
  readonly loadAISDK?: (model: RuntimeInfo) => Effect.Effect<LanguageModel, AISDK.InitError>
}

export const fromCatalogModel = (
  model: RuntimeInfo,
  credential?: Credential.Value,
  dependencies?: Dependencies,
): Effect.Effect<
  LanguageModel,
  | UnsupportedPackageError
  | ModelConfigurationError
  | ModelInitializationError
  | UnresolvedProviderVariablesError
  | UnsupportedCompactionError
> =>
  resolveCatalogModel(model, credential, dependencies).pipe(
    Effect.flatMap((resolved) => validateProviderVariables(model, resolved)),
    Effect.flatMap((resolved) => {
      // Reject provider compaction policies up front so the misconfiguration surfaces before any step runs.
      if (
        model.settings?.compaction?.type !== "native" ||
        resolved.route.compact?.trigger ||
        resolved.route.compact?.endpoint
      )
        return Effect.succeed(resolved)
      return Effect.fail(
        new UnsupportedCompactionError({ providerID: model.providerID, modelID: model.id, route: resolved.route.id }),
      )
    }),
  )

const resolveCatalogModel = Effect.fn("ModelResolver.resolveCatalogModel")(function* (
  model: RuntimeInfo,
  credential?: Credential.Value,
  dependencies?: Dependencies,
) {
  const resolved = prepareRuntimeModel(model, credential)
  const configuration = credential?.type === "key" ? credential.configuration : undefined
  const configured = { ...resolved.settings, ...credential?.metadata, ...configuration }
  if (Provider.isAISDK(resolved.package)) {
    const loadAISDK = dependencies?.loadAISDK
    if (!loadAISDK) return yield* unsupported(resolved)
    const settings = yield* prepareProviderSettings(
      resolved,
      Provider.mergeOverlay(resolved.settings, {
        ...nativeCredentialSettings(resolved.package ?? "", credential),
        ...credential?.metadata,
        ...configuration,
      }) ?? {},
    )
    return yield* loadAISDK({ ...resolved, settings }).pipe(
      Effect.mapError((error) => initialization(resolved, "init", error.cause)),
    )
  }
  const specifier = Provider.packageName(resolved.package)
  if (!specifier) return yield* unsupported(resolved)
  const mapped = yield* prepareProviderSettings(resolved, Provider.nativeSettings(configured))
  const module = yield* (dependencies?.loadPackage ?? Provider.loadPackage)(specifier).pipe(
    Effect.mapError((error) => initialization(resolved, "load", error.cause)),
  )
  const settings = {
    ...(credential ? Struct.omit(mapped, ["accessToken", "apiKey", "authToken"]) : mapped),
    ...(resolved.canonical === undefined ? {} : { provider: resolved.canonical }),
    ...nativeCredentialSettings(specifier, credential),
    headers: resolved.headers,
    body: resolved.body,
  }
  return yield* Effect.try({
    try: () => {
      const runtime = module.model(resolved.modelID ?? resolved.id, settings)
      return LanguageModel.update(runtime, {
        provider: resolved.canonical ?? resolved.providerID,
        compatibility: resolved.compatibility
          ? Object.assign({}, runtime.compatibility, resolved.compatibility)
          : runtime.compatibility,
        defaults: {
          ...runtime.defaults,
          http: mergeHttpOptions(runtime.defaults?.http, new HttpOptions(Provider.timeouts(configured))),
        },
      })
    },
    catch: (cause) =>
      cause instanceof ProviderConfigurationError
        ? new ModelConfigurationError({
            providerID: resolved.providerID,
            modelID: resolved.id,
            package: resolved.package ?? "unknown",
            detail: cause.message,
          })
        : initialization(resolved, "construct", cause),
  })
})

function prepareRuntimeModel(model: RuntimeInfo, credential: Credential.Value | undefined) {
  if (model.settings?.apiKey !== "" && (credential?.type !== "key" || credential.metadata === undefined)) return model
  return {
    ...model,
    ...(model.settings?.apiKey === "" ? { settings: Struct.omit(model.settings, ["apiKey"]) } : {}),
    ...(credential?.type === "key" && credential.metadata !== undefined
      ? { body: Provider.mergeOverlay(model.body, credential.metadata) }
      : {}),
  }
}

function validateProviderVariables(
  model: RuntimeInfo,
  resolved: LanguageModel,
): Effect.Effect<LanguageModel, UnresolvedProviderVariablesError> {
  const baseURL = resolved.route.endpoint.baseURL
  if (typeof baseURL !== "string") return Effect.succeed(resolved)
  const failure = unresolvedProviderVariables(model, baseURL)
  return failure ? Effect.fail(failure) : Effect.succeed(resolved)
}

function prepareProviderSettings(
  model: RuntimeInfo,
  settings: Readonly<Record<string, unknown>>,
): Effect.Effect<Readonly<Record<string, unknown>>, UnresolvedProviderVariablesError> {
  const baseURL = settings.baseURL
  if (typeof baseURL !== "string") return Effect.succeed(settings)
  return prepareProviderURL(model, baseURL).pipe(
    Effect.map((prepared) => (prepared === baseURL ? settings : { ...settings, baseURL: prepared })),
  )
}

function prepareProviderURL(
  model: RuntimeInfo,
  baseURL: string,
): Effect.Effect<string, UnresolvedProviderVariablesError> {
  if (!baseURL.includes("${")) return Effect.succeed(baseURL)
  const prepared = baseURL.replace(/\$\{([^}]+)\}/g, (placeholder, name: string) => process.env[name] ?? placeholder)
  const failure = unresolvedProviderVariables(model, prepared)
  return failure ? Effect.fail(failure) : Effect.succeed(prepared)
}

function unresolvedProviderVariables(model: RuntimeInfo, baseURL: string) {
  const variables = new Set(Array.from(baseURL.matchAll(/\$\{([^}]+)\}/g), (match) => match[1]))
  if (variables.size === 0) return
  return new UnresolvedProviderVariablesError({
    providerID: model.providerID,
    modelID: model.id,
    variables: Array.from(variables),
  })
}

const nativeCredentialSettings = (specifier: string, credential: Credential.Value | undefined) => {
  if (!credential) return {}
  if (credential.type === "key") return { apiKey: credential.key }
  if (specifier === "@opencode/ai/providers/anthropic" || specifier === "@opencode/ai/providers/anthropic-compatible")
    return { authToken: credential.access }
  if (
    specifier === "@opencode/ai/providers/google-vertex" ||
    specifier.startsWith("@opencode/ai/providers/google-vertex/")
  )
    return { accessToken: credential.access }
  return { apiKey: credential.access }
}

const unsupported = (model: RuntimeInfo) =>
  new UnsupportedPackageError({
    providerID: model.providerID,
    modelID: model.id,
    package: model.package ?? "unknown",
  })

const initialization = (model: RuntimeInfo, phase: InitializationPhase, cause: unknown) =>
  new ModelInitializationError({
    providerID: model.providerID,
    modelID: model.id,
    package: model.package ?? "unknown",
    phase,
    detail: causeMessage(cause) ?? `${phase} failed for ${model.package ?? "unknown"}`,
  })

// Unexpected throws still carry the most useful diagnosis in their message; a stack or an unknown value does not.
const causeMessage = (cause: unknown): string | undefined => {
  if (typeof cause === "string") return cause.trim() || undefined
  if (!(cause instanceof globalThis.Error)) return undefined
  const message = cause.message.trim()
  if (message) return message
  return causeMessage(cause.cause)
}

export const resolveModel = (
  model: Info,
  variant: VariantID | undefined,
  credential?: Credential.Value,
  dependencies?: Dependencies,
) => withVariant(model, variant).pipe(Effect.flatMap((model) => fromCatalogModel(model, credential, dependencies)))

export const hasPackage = (model: Info) => Boolean(model.package)

/** Bind the access used by the displayed catalog without changing the integration's active account. */
export const bind = Effect.fn("ModelResolver.bind")(function* (model: Ref) {
  if (model.connection) return model
  // Embedded admission-only graphs have no provider registry and retain legacy unbound references.
  const providers = yield* Effect.serviceOption(Provider.Service)
  const integrations = yield* Effect.serviceOption(Integration.Service)
  if (Option.isNone(providers) || Option.isNone(integrations)) return model
  const definition = (yield* providers.value.snapshot()).records.get(model.providerID)
  const connection =
    definition?.sourceConnection ??
    (yield* integrations.value.connection.active(
      definition?.provider.integrationID ?? Integration.ID.make(model.providerID),
    ))
  return connection
    ? Ref.make({
        ...model,
        connection: IntegrationConnection.ref(connection),
      })
    : model
})

/** Resolves catalog selections into runtime models for the current Location. */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const providers = yield* Provider.Service
    const models = yield* Model.Service
    const integrations = yield* Integration.Service
    const npm = yield* Npm.Service
    const aisdk = yield* AISDK.Service
    const credentials = yield* Credential.Service
    const kv = yield* KV.Service
    const modelsDev = yield* ModelsDev.Service
    // The node graph wires configuration in; a resolver built from the bare layer, as embedded graphs and
    // tests do, has no configured limits to apply.
    const config = Option.getOrUndefined(yield* Effect.serviceOption(Config.Service))
    /** The limit the configuration declares for a model, later documents overriding earlier ones field by field. */
    const configuredLimit = Effect.fn("ModelResolver.configuredLimit")(function* (
      providerID: Provider.ID,
      modelID: ID,
    ) {
      if (!config) return undefined
      const limits = (yield* config.entries()).flatMap((entry) =>
        entry.type === "document" ? (entry.info.providers?.[providerID]?.models?.[modelID]?.limit ?? []) : [],
      )
      if (!limits.length) return undefined
      return limits.reduce<Partial<Info["limit"]>>((merged, limit) => ({ ...merged, ...limit }), {})
    })
    const load = Effect.fn("ModelResolver.resolveModel")(function* (
      selected: Info,
      variant?: VariantID,
      pinned?: Ref["connection"],
    ) {
      const provider = yield* providers.get(selected.providerID)
      const integrationID = provider?.integrationID ?? Integration.ID.make(selected.providerID)
      const connection = pinned
        ? (yield* integrations.get(integrationID))?.connections.find(
            (connection) => IntegrationConnection.key(connection) === IntegrationConnection.key(pinned),
          )
        : yield* integrations.connection.active(integrationID)
      if (pinned && !connection)
        return yield* new ModelConfigurationError({
          providerID: selected.providerID,
          modelID: selected.id,
          package: selected.package ?? "",
          detail:
            "The selected connection is unavailable. Reconnect it or explicitly select another connection; the active account will not be substituted.",
        })
      const credential = connection ? yield* integrations.connection.resolve(connection) : undefined
      if (pinned && (!credential || (credential.type === "oauth" && credential.expires <= Date.now())))
        return yield* new ModelConfigurationError({
          providerID: selected.providerID,
          modelID: selected.id,
          package: selected.package ?? "",
          detail:
            "The selected connection has no usable credential. Reconnect it; the active account will not be substituted.",
        })
      const router = pinned && ["red-router", "9router"].includes(selected.providerID)
      const bound =
        router && credential && connection
          ? yield* Effect.gen(function* () {
              const { connectionModel } = yield* Effect.promise(() => import("./plugin/provider/red-router.js"))
              return yield* connectionModel(selected.providerID, selected.id, connection, credential).pipe(
                Effect.provideService(Credential.Service, credentials),
                Effect.provideService(KV.Service, kv),
                Effect.provideService(ModelsDev.Service, modelsDev),
              )
            })
          : selected
      if (!bound)
        return yield* new ModelConfigurationError({
          providerID: selected.providerID,
          modelID: selected.id,
          package: selected.package ?? "",
          detail:
            "The model is not in this connection's cached catalog. Refresh that connection's catalog before continuing.",
        })
      const source = router
        ? (yield* providers.snapshot()).records.get(selected.providerID)?.sourceConnection
        : undefined
      const live =
        router && Boolean(selected.package) && IntegrationConnection.key(source) === IntegrationConnection.key(pinned)
      // The live catalog already carries configured overrides. A saved connection's entry is materialized
      // here, past the configuration plugin, so the configured limit is applied to it directly.
      const configured = router && !live ? yield* configuredLimit(selected.providerID, selected.id) : undefined
      const catalog = live
        ? { ...selected, settings: { ...selected.settings, baseURL: bound.settings?.baseURL } }
        : configured
          ? { ...bound, limit: { ...bound.limit, ...configured } }
          : bound
      const selectedVariant = yield* withVariant(catalog, variant)
      const runtimeInfo: RuntimeInfo = {
        ...selectedVariant,
        settings: Provider.mergeOverlay(
          router && provider?.settings ? Struct.omit(provider.settings, ["baseURL"]) : provider?.settings,
          Provider.modelSettings(selectedVariant.settings),
        ),
      }
      const model = yield* fromCatalogModel(runtimeInfo, credential, {
        loadPackage: (specifier) => Provider.loadPackage(specifier, npm),
        loadAISDK: (model) => aisdk.model(model),
      })
      const runtime =
        provider?.activation === "enabled" &&
        credential === undefined &&
        !hasConfiguredAuth(runtimeInfo) &&
        usesAPIKeyAuth(runtimeInfo.package)
          ? LanguageModel.update(model, { route: model.route.with({ auth: Auth.none }) })
          : model
      return {
        model: runtime,
        ref: Ref.make({
          id: selected.id,
          providerID: selected.providerID,
          ...(variant === undefined ? {} : { variant }),
          ...(connection ? { connection: IntegrationConnection.ref(connection) } : {}),
        }),
        capabilities: catalog.capabilities,
        cost: catalog.cost,
        limit: catalog.limit,
        compaction: runtimeInfo.settings?.compaction,
        transport: provider?.settings?.transport,
        chunkTimeout: Provider.timeout(provider?.settings?.chunkTimeout),
      }
    })
    return Service.of({
      resolve: Effect.fn("ModelResolver.resolve")(function* (requested) {
        const selected = requested
          ? ((yield* models.get(requested.providerID, requested.id)) ??
            (requested.connection && ["red-router", "9router"].includes(requested.providerID)
              ? Info.default(requested.providerID, requested.id)
              : undefined))
          : yield* models
              .default()
              .pipe(
                Effect.flatMap((model) =>
                  model && hasPackage(model)
                    ? Effect.succeed(model)
                    : Effect.map(models.available(), (models) => models.find(hasPackage)),
                ),
              )
        if (!selected) return undefined
        return yield* load(selected, requested?.variant, requested?.connection)
      }),
      resolveModel: load,
    })
  }),
)

function hasConfiguredAuth(model: RuntimeInfo) {
  return [model.settings?.apiKey, model.settings?.authToken, model.settings?.accessToken].some(
    (value) => typeof value === "string" && value !== "",
  )
}

function usesAPIKeyAuth(packageName: string | undefined) {
  const name = Provider.packageName(packageName)
  return (
    name === "@ai-sdk/openai" ||
    name === "@ai-sdk/anthropic" ||
    name === "@ai-sdk/cerebras" ||
    name === "@ai-sdk/deepinfra" ||
    name === "@ai-sdk/openai-compatible" ||
    name === "@ai-sdk/google" ||
    name === "@ai-sdk/groq" ||
    name === "@ai-sdk/mistral" ||
    name === "@ai-sdk/togetherai" ||
    name === "@ai-sdk/xai" ||
    name === "@openrouter/ai-sdk-provider" ||
    name === "@ai-sdk/azure" ||
    name === "@opencode/ai/providers/openai" ||
    name?.startsWith("@opencode/ai/providers/openai/") === true ||
    name === "@opencode/ai/providers/anthropic" ||
    name === "@opencode/ai/providers/anthropic-compatible" ||
    name === "@opencode/ai/providers/baseten" ||
    name === "@opencode/ai/providers/cerebras" ||
    name === "@opencode/ai/providers/cloudflare-ai-gateway" ||
    name === "@opencode/ai/providers/cloudflare-workers-ai" ||
    name === "@opencode/ai/providers/deepinfra" ||
    name === "@opencode/ai/providers/deepseek" ||
    name === "@opencode/ai/providers/fireworks" ||
    name === "@opencode/ai/providers/openai-compatible" ||
    name === "@opencode/ai/providers/google" ||
    name === "@opencode/ai/providers/groq" ||
    name === "@opencode/ai/providers/mistral" ||
    name === "@opencode/ai/providers/togetherai" ||
    name === "@opencode/ai/providers/xai" ||
    name === "@opencode/ai/providers/openrouter" ||
    name === "@opencode/ai/providers/azure" ||
    name?.startsWith("@opencode/ai/providers/azure/") === true
  )
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Provider.node,
    Model.node,
    Integration.node,
    Credential.node,
    KV.node,
    ModelsDev.node,
    Config.node,
    Npm.node,
    AISDK.node,
  ],
})
