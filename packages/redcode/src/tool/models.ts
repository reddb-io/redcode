import fuzzysort from "fuzzysort"
import { Effect, Schema } from "effect"
import { ModelsDev } from "@reddb-io/redcode-core/models-dev"
import { ReasoningAuto } from "@reddb-io/redcode-core/session/reasoning-auto"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import * as Tool from "./tool"
import DESCRIPTION from "./models.txt"

export const ID = "models"
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export const Parameters = Schema.Struct({
  query: Schema.optional(Schema.String).annotate({
    description: "Words to look for in model ids and names, e.g. opus or gpt 5. Every word must match.",
  }),
  provider: Schema.optional(Schema.String).annotate({
    description: "Only models of this provider, by id or name. Try your own provider first.",
  }),
  capabilities: Schema.optional(Schema.Array(Schema.Literals(["reasoning", "tool_call", "attachments"]))).annotate({
    description: "Only models that have every one of these capabilities.",
  }),
  all: Schema.optional(Schema.Boolean).annotate({
    description: "Include older versions of each model family. By default only the newest of each family is listed.",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: `Maximum models to return (default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}).`,
  }),
  cursor: Schema.optional(Schema.String).annotate({
    description: "The cursor a previous page returned, to read the next page.",
  }),
})

type Metadata = { total: number; count: number; next?: string }

/** Whether a subagent can run on the model: never a System One evaluator, never a deprecated model. */
export function runnable(model: Provider.Model) {
  return (
    model.status !== "deprecated" &&
    model.capabilities.protocol !== "systemone" &&
    // A model the configuration redeclares loses the catalog's protocol, so the offer list decides too.
    !ModelsDev.systemOneOffer(model.providerID, model.id)
  )
}

/** Every model a subagent can run on, across the connected providers. */
export function selectable(providers: Record<string, Provider.Info>) {
  return Object.values(providers).flatMap((provider) => Object.values(provider.models).filter(runnable))
}

/** The `providerID/modelID` references closest to what was asked for, best first. */
export function closest(models: ReadonlyArray<Provider.Model>, text: string, limit = 5) {
  const refs = models.map((model) => `${model.providerID}/${model.id}`)
  const fuzzy = fuzzysort.go(text, refs, { limit }).map((match) => match.target)
  if (fuzzy.length) return fuzzy
  // A typo breaks fuzzy matching, which needs every character in order; shared words still point the way.
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1)
  return refs
    .map((ref) => ({ ref, score: words.filter((word) => ref.toLowerCase().includes(word)).length }))
    .filter((item) => item.score > 0)
    .toSorted((a, b) => b.score - a.score || a.ref.localeCompare(b.ref))
    .slice(0, limit)
    .map((item) => item.ref)
}

export const ModelsTool = Tool.define<typeof Parameters, Metadata, Provider.Service | Session.Service>(
  ID,
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const sessions = yield* Session.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const offset = params.cursor === undefined ? 0 : Number(params.cursor)
          if (!Number.isInteger(offset) || offset < 0)
            return yield* Effect.die(
              new Error(`Invalid cursor "${params.cursor}": pass the cursor a previous page returned.`),
            )
          const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(params.limit ?? DEFAULT_LIMIT)))
          const session = yield* sessions.get(ctx.sessionID).pipe(Effect.orElseSucceed(() => undefined))
          const own = session?.model?.providerID
          const providers = yield* provider.list()
          const wanted = params.provider?.trim().toLowerCase()
          const words = params.query?.toLowerCase().split(/\s+/u).filter(Boolean) ?? []
          const matching = selectable(providers)
            .filter(
              (model) =>
                !wanted ||
                model.providerID.toLowerCase() === wanted ||
                providers[model.providerID]?.name.toLowerCase() === wanted,
            )
            .filter((model) => (params.capabilities ?? []).every((capability) => has(model, capability)))
            .filter((model) => {
              const text = `${model.providerID}/${model.id} ${model.name}`.toLowerCase()
              return words.every((word) => text.includes(word))
            })
            .toSorted(
              (a, b) =>
                Number(b.providerID === own) - Number(a.providerID === own) ||
                a.providerID.localeCompare(b.providerID) ||
                b.release_date.localeCompare(a.release_date) ||
                a.id.localeCompare(b.id),
            )
            // Sorted newest first within a provider, so the first of a family is its newest.
            .filter(
              (model, index, sorted) =>
                params.all ||
                !model.family ||
                sorted.findIndex((other) => other.providerID === model.providerID && other.family === model.family) ===
                  index,
            )
          const page = matching.slice(offset, offset + limit)
          const next = offset + limit < matching.length ? String(offset + limit) : undefined
          const title = params.query ? `Models: ${params.query}` : "Models"
          if (page.length === 0)
            return {
              title,
              output:
                matching.length === 0
                  ? "No model matches. Loosen the query, drop the provider or capability filter, or pass all: true."
                  : `No models past cursor ${offset}; ${matching.length} match in total.`,
              metadata: { total: matching.length, count: 0 },
            }
          return {
            title,
            output: [
              `Models ${offset + 1}-${offset + page.length} of ${matching.length}${own ? `, your provider (${own}) first` : ""}, newest first${params.all ? "" : ", one per family"}. Pass the id as the task tool's model and a listed variant as its variant.`,
              ...page.map((model) => `- ${line(model, providers[model.providerID]?.name ?? model.providerID)}`),
              ...(next ? [`More models: call again with cursor "${next}".`] : []),
            ].join("\n"),
            metadata: { total: matching.length, count: page.length, ...(next ? { next } : {}) },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)

function has(model: Provider.Model, capability: "reasoning" | "tool_call" | "attachments") {
  if (capability === "reasoning") return model.capabilities.reasoning
  if (capability === "tool_call") return model.capabilities.toolcall
  return model.capabilities.attachment
}

function line(model: Provider.Model, provider: string) {
  const variants = ReasoningAuto.options(Object.keys(model.variants ?? {}))
  return [
    `${model.providerID}/${model.id}`,
    model.name,
    `provider ${provider}`,
    `context ${model.limit.context} tokens, output ${model.limit.output}`,
    ...(variants.length ? [`variants: ${variants.join(", ")}`] : []),
    ...(model.cost.unknown ? [] : [`$${model.cost.input} input, $${model.cost.output} output per 1M tokens`]),
    ...(model.release_date ? [`released ${model.release_date}`] : []),
  ].join(" · ")
}
