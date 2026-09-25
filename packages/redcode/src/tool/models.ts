import { Effect, Schema } from "effect"
import { ModelChoice } from "@reddb-io/redcode-core/model-choice"
import { ReasoningAuto } from "@reddb-io/redcode-core/session/reasoning-auto"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import * as Tool from "./tool"

export const ID = "models"

export const Parameters = ModelChoice.Parameters

type Metadata = { total: number; count: number; next?: string }

/** Whether a subagent can run on the model: never a System One evaluator, never a deprecated model. */
export function runnable(model: Provider.Model) {
  return ModelChoice.runnable({
    providerID: model.providerID,
    id: model.id,
    status: model.status,
    protocol: model.capabilities.protocol,
    flat: model.flat,
    offers: model.offers,
  })
}

/**
 * Every model a subagent can run on, across the connected providers. A pinned offer of a flat model
 * is left out as a duplicate of that model; its id still resolves when asked for.
 */
export function selectable(providers: Record<string, Provider.Info>) {
  return Object.values(providers).flatMap((provider) =>
    Object.values(provider.models).filter((model) => !model.pinOf && runnable(model)),
  )
}

/** The `providerID/modelID` references closest to what was asked for, best first. */
export function closest(models: ReadonlyArray<Provider.Model>, text: string, limit = 5) {
  return ModelChoice.closest(
    models.map((model) => `${model.providerID}/${model.id}`),
    text,
    limit,
  )
}

export const ModelsTool = Tool.define<typeof Parameters, Metadata, Provider.Service | Session.Service>(
  ID,
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const sessions = yield* Session.Service
    return {
      description: ModelChoice.DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const session = yield* sessions.get(ctx.sessionID).pipe(Effect.orElseSucceed(() => undefined))
          const providers = yield* provider.list()
          const result = ModelChoice.search(
            selectable(providers).map((model) => entry(model, providers[model.providerID]?.name ?? model.providerID)),
            params,
            session?.model?.providerID,
          )
          if (result.type === "invalid") return yield* Effect.die(new Error(result.message))
          return {
            title: result.title,
            output: result.output,
            metadata: { total: result.total, count: result.count, ...(result.next ? { next: result.next } : {}) },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)

function entry(model: Provider.Model, provider: string): ModelChoice.Entry {
  return {
    providerID: model.providerID,
    id: model.id,
    name: model.name,
    provider,
    ...(model.family ? { family: model.family } : {}),
    released: model.release_date,
    reasoning: model.capabilities.reasoning,
    toolCall: model.capabilities.toolcall,
    attachments: model.capabilities.attachment,
    variants: ReasoningAuto.options(Object.keys(model.variants ?? {})),
    limit: { context: model.limit.context, output: model.limit.output },
    ...(model.cost.unknown ? {} : { cost: { input: model.cost.input, output: model.cost.output } }),
  }
}
