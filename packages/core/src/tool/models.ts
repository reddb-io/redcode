export * as ModelsTool from "./models"

import { ToolFailure } from "@reddb-io/redcode-llm"
import { Effect, Layer, Schema } from "effect"
import { Catalog } from "../catalog"
import { makeLocationNode } from "../effect/app-node"
import { ModelChoice } from "../model-choice"
import type { ModelV2 } from "../model"
import { ReasoningAuto } from "../session/reasoning-auto"
import { SessionStore } from "../session/store"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "models"

export const Output = Schema.Struct({
  title: Schema.String,
  output: Schema.String,
  metadata: Schema.Struct({
    total: Schema.Number,
    count: Schema.Number,
    next: Schema.optional(Schema.String),
  }),
})

/** Every model a subagent can run on among the connected providers, as the shared search reads them. */
export const entries = Effect.fn("ModelsTool.entries")(function* (catalog: Catalog.Interface) {
  const providers = new Map((yield* catalog.provider.available()).map((provider) => [provider.id, provider.name]))
  return (yield* catalog.model.available())
    .filter((model) =>
      ModelChoice.runnable({
        providerID: model.providerID,
        id: model.id,
        status: model.status,
        protocol: model.capabilities.protocol,
      }),
    )
    .map((model) => entry(model, providers.get(model.providerID) ?? model.providerID))
})

/**
 * The V2 `models` tool: the legacy tool's search over the V2 catalog. A read-only listing, so like
 * legacy it asks no permission; an agent whose rules deny it never sees it.
 */
const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const catalog = yield* Catalog.Service
    const sessions = yield* SessionStore.Service
    yield* tools
      .register({
        [name]: Tool.make({
          description: ModelChoice.DESCRIPTION,
          input: ModelChoice.Parameters,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: output.output }],
          execute: (input, context) =>
            Effect.gen(function* () {
              const session = yield* sessions.get(context.sessionID)
              const result = ModelChoice.search(yield* entries(catalog), input, session?.model?.providerID)
              if (result.type === "invalid") return yield* new ToolFailure({ message: result.message })
              return {
                title: result.title,
                output: result.output,
                metadata: { total: result.total, count: result.count, ...(result.next ? { next: result.next } : {}) },
              }
            }),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

function entry(model: ModelV2.Info, provider: string): ModelChoice.Entry {
  const variants = model.variants.map((variant) => variant.id)
  const cost = model.cost[0]
  return {
    providerID: model.providerID,
    id: model.id,
    name: model.name,
    provider,
    ...(model.family ? { family: model.family } : {}),
    released: model.time.released > 0 ? new Date(model.time.released).toISOString().slice(0, 10) : "",
    // The V2 catalog keeps no reasoning flag: a model with effort variants reasons.
    reasoning: variants.length > 0,
    toolCall: model.capabilities.tools,
    attachments: model.capabilities.input.some((kind) => kind !== "text"),
    variants: ReasoningAuto.options(variants),
    limit: { context: model.limit.context, output: model.limit.output },
    ...(cost && (cost.input > 0 || cost.output > 0) ? { cost: { input: cost.input, output: cost.output } } : {}),
  }
}

export const node = makeLocationNode({
  name: "tool/models",
  layer,
  deps: [ToolRegistry.toolsNode, Catalog.node, SessionStore.node],
})
