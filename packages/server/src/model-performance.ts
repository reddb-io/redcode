import { and, desc, eq, gte } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { Database } from "@opencode/core/database/database"
import { SessionMessageTable } from "@opencode/core/session/sql"
import { ModelPerformance } from "@opencode/schema/model-performance"
import { Model } from "@opencode/schema/model"
import { SessionMessage } from "@opencode/schema/session-message"
import { GenerationTiming } from "@opencode/util/generation-timing"

const WINDOW_MS = 24 * 60 * 60 * 1000
const ROW_LIMIT = 5_000
const AssistantEncoded = Schema.toEncoded(SessionMessage.Assistant)
const decodeAssistant = Schema.decodeUnknownOption(AssistantEncoded, { onExcessProperty: "ignore" })

type Sample = {
  requests: number
  errors: number
  latency: number[]
  throughput: number[]
}

const empty = (): Sample => ({ requests: 0, errors: 0, latency: [], throughput: [] })

function percentile(values: readonly number[], fraction: number) {
  if (values.length === 0) return
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) * fraction)]
}

function metrics(sample: Sample) {
  return {
    requests: sample.requests,
    errors: sample.errors,
    latencyP50: percentile(sample.latency, 0.5),
    latencyP95: percentile(sample.latency, 0.95),
    throughputP50: percentile(sample.throughput, 0.5),
  }
}

function record(sample: Sample, timing: GenerationTiming.Step | undefined, failed: boolean) {
  sample.requests += 1
  if (failed) sample.errors += 1
  if (timing) sample.latency.push(timing.latency)
  if (timing?.speed !== undefined) sample.throughput.push(timing.speed)
}

export function summarizeModelPerformance(
  rows: ReadonlyArray<{ readonly id: string; readonly data: unknown }>,
  sampledAt = Date.now(),
) {
  const from = sampledAt - WINDOW_MS
  const total = empty()
  const providers = new Map<string, Sample>()
  const models = new Map<string, { ref: ModelPerformance.ModelEntry["model"]; sample: Sample }>()

  for (const row of rows) {
    const data = typeof row.data === "object" && row.data !== null ? row.data : {}
    const message = Option.getOrUndefined(decodeAssistant({ id: row.id, type: "assistant", ...data }))
    if (!message) continue
    const timing = GenerationTiming.step(message)
    const failed = message.error !== undefined
    const providerID = message.model.providerID
    const provider = providers.get(providerID) ?? empty()
    providers.set(providerID, provider)
    const decodedModel = Schema.decodeUnknownSync(Model.Ref)(message.model)
    const ref: ModelPerformance.ModelEntry["model"] = {
      providerID: decodedModel.providerID,
      id: decodedModel.id,
      ...(decodedModel.variant ? { variant: decodedModel.variant } : {}),
    }
    const modelKey = `${ref.providerID}/${ref.id}${ref.variant ? `#${ref.variant}` : ""}`
    const model = models.get(modelKey) ?? { ref, sample: empty() }
    models.set(modelKey, model)
    record(total, timing, failed)
    record(provider, timing, failed)
    record(model.sample, timing, failed)
  }

  return ModelPerformance.Snapshot.make({
    sampledAt,
    from,
    ...metrics(total),
    providers: Array.from(providers, ([providerID, sample]) =>
      ModelPerformance.Provider.make({ providerID, ...metrics(sample) }),
    ).toSorted((a, b) => b.requests - a.requests || a.providerID.localeCompare(b.providerID)),
    models: Array.from(models.values(), ({ ref, sample }) =>
      ModelPerformance.ModelEntry.make({ model: ref, ...metrics(sample) }),
    ).toSorted(
      (a, b) =>
        b.requests - a.requests ||
        `${a.model.providerID}/${a.model.id}`.localeCompare(`${b.model.providerID}/${b.model.id}`),
    ),
  })
}

/** A bounded, on-demand summary of persisted model responses. No collector runs in the background. */
export const modelPerformance = Effect.fn("ModelPerformance.snapshot")(function* () {
  const sampledAt = Date.now()
  const from = sampledAt - WINDOW_MS
  const storage = yield* Database.Service
  const rows = yield* storage.db
    .select({ id: SessionMessageTable.id, data: SessionMessageTable.data })
    .from(SessionMessageTable)
    .where(and(eq(SessionMessageTable.type, "assistant"), gte(SessionMessageTable.time_created, from)))
    .orderBy(desc(SessionMessageTable.time_created))
    .limit(ROW_LIMIT)
    .pipe(Effect.orElseSucceed(() => []))
  return summarizeModelPerformance(rows, sampledAt)
})
