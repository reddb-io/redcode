export * as SessionRunnerModel from "./model.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LanguageModel } from "@opencode/ai"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Context, Effect, Layer, Schema } from "effect"
import { ModelResolver } from "../../model-resolver.js"
import { Intelligence } from "../../intelligence.js"
import { IntelligenceEvaluation } from "../../intelligence/evaluation.js"
import { SessionSchema } from "../schema.js"

export class ModelNotSelectedError extends Schema.TaggedError<ModelNotSelectedError>()(
  "SessionRunnerModel.ModelNotSelectedError",
  { sessionID: SessionSchema.ID },
) {
  override get message() {
    return `No model is available for session ${this.sessionID}. Connect a provider with /connect or set a provider key.`
  }
}

export class ModelUnavailableError extends Schema.TaggedError<ModelUnavailableError>()(
  "SessionRunnerModel.ModelUnavailableError",
  { providerID: Provider.ID, modelID: Model.ID },
) {
  override get message() {
    if (this.providerID === "azure-cognitive-services")
      return `Model unavailable: ${this.providerID}/${this.modelID}. This provider has been deprecated; use azure/${this.modelID} instead.`
    if (this.providerID === "google-vertex-anthropic")
      return `Model unavailable: ${this.providerID}/${this.modelID}. This provider has been deprecated; use google-vertex/${this.modelID} instead.`
    return `Model unavailable: ${this.providerID}/${this.modelID}`
  }
}
export const VariantUnavailableError = ModelResolver.VariantUnavailableError
export type VariantUnavailableError = ModelResolver.VariantUnavailableError
export const UnsupportedPackageError = ModelResolver.UnsupportedPackageError
export type UnsupportedPackageError = ModelResolver.UnsupportedPackageError
export const ModelConfigurationError = ModelResolver.ModelConfigurationError
export type ModelConfigurationError = ModelResolver.ModelConfigurationError
export const ModelInitializationError = ModelResolver.ModelInitializationError
export type ModelInitializationError = ModelResolver.ModelInitializationError
export const UnresolvedProviderVariablesError = ModelResolver.UnresolvedProviderVariablesError
export type UnresolvedProviderVariablesError = ModelResolver.UnresolvedProviderVariablesError
export const UnsupportedCompactionError = ModelResolver.UnsupportedCompactionError
export type UnsupportedCompactionError = ModelResolver.UnsupportedCompactionError

export type Error = ModelNotSelectedError | ModelUnavailableError | ModelResolver.Error | IntelligenceEvaluation.Error
export type Resolved = ModelResolver.Resolved

export interface Interface {
  /** Availability is sampled lazily for each explicitly selected model resolution. */
  readonly resolve: (
    session: SessionSchema.Info,
    available: () => Effect.Effect<ReadonlyArray<Model.Info>>,
  ) => Effect.Effect<Resolved, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRunnerModel") {}

/** Builds a Resolved whose catalog identity mirrors the route model. Test or embedding seam. */
export const resolved = (
  model: LanguageModel,
  options: {
    readonly capabilities: Model.Capabilities
    readonly variant?: Model.VariantID
    readonly cost: Model.Info["cost"]
    readonly limit: Model.Info["limit"]
    readonly compaction?: Provider.Compaction
    readonly transport?: Provider.Transport
  },
): Resolved => ({
  model,
  ref: Model.Ref.make({
    id: Model.ID.make(model.id),
    providerID: Provider.ID.make(model.provider),
    ...(options.variant === undefined ? {} : { variant: options.variant }),
  }),
  capabilities: options.capabilities,
  cost: options.cost,
  limit: options.limit,
  compaction: options.compaction,
  transport: options.transport,
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const resolver = yield* ModelResolver.Service
    const intelligence = yield* Intelligence.Service
    return Service.of({
      resolve: Effect.fn("SessionRunnerModel.resolve")(function* (session, available) {
        const settings = yield* intelligence.read(session.id)
        yield* IntelligenceEvaluation.requireConfigured(settings)
        const selected =
          settings.enabled && !session.model && settings.principal ? { ...session, model: settings.principal } : session
        // Location plugins populate and filter the catalog asynchronously during layer startup.
        if (!selected.model) {
          const resolved = yield* resolver.resolve()
          if (resolved) return resolved
          return yield* new ModelNotSelectedError({ sessionID: session.id })
        }
        if (selected.model.connection) {
          const resolved = yield* resolver.resolve(selected.model)
          if (resolved) return resolved
          return yield* new ModelUnavailableError({ providerID: selected.model.providerID, modelID: selected.model.id })
        }
        const model = (yield* available()).find(
          (model) => model.providerID === selected.model?.providerID && model.id === selected.model.id,
        )
        if (!model)
          return yield* new ModelUnavailableError({
            providerID: selected.model.providerID,
            modelID: selected.model.id,
          })
        return yield* resolver.resolveModel(model, selected.model.variant)
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [ModelResolver.node, Intelligence.node] })
