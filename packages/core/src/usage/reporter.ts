export * as Reporter from "./reporter.js"

import { createHmac, randomUUID } from "node:crypto"
import { and, asc, desc, eq, inArray, lte, or, sql } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Option, Schema, Semaphore } from "effect"
import { UsageReporter } from "@opencode/schema/usage-reporter"
import { SessionMessage } from "@opencode/schema/session-message"
import { SessionEvent } from "@opencode/schema/session-event"
import { Event } from "@opencode/schema/event"
import { Integration } from "@opencode/schema/integration"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Database } from "../database/database.js"
import { Credential } from "../credential.js"
import { SessionMessageTable, SessionTable } from "../session/sql.js"
import { EventTable } from "../event/sql.js"
import { IntelligenceEvaluationTable } from "../intelligence/sql.js"
import { UsageReporterConfigTable, UsageReporterDeliveryTable, UsageReporterRecordTable } from "./reporter.sql.js"

type Config = typeof UsageReporterConfigTable.$inferSelect
type Destination = (typeof UsageReporterDeliveryTable.$inferSelect)["destination"]
type SessionRow = typeof SessionTable.$inferSelect
const emptyMessages = { total: 0, user: 0, assistant: 0 }
const emptyTools = { calls: 0, succeeded: 0, failed: 0, unfinished: 0, durationMs: 0 }
const integration = Integration.ID.make("redcode-usage-reporter")
const terminalEvents = [SessionEvent.Step.Ended, SessionEvent.Step.Failed, SessionEvent.UsageRecorded]
const types = terminalEvents.map((event) => Event.versionedType(event.type, event.durable.version))

export interface Interface {
  readonly configuration: () => Effect.Effect<UsageReporter.Config>
  readonly snapshot: () => Effect.Effect<UsageReporter.Snapshot>
  readonly configure: (input: UsageReporter.Configure) => Effect.Effect<UsageReporter.Snapshot, Error>
  readonly collect: () => Effect.Effect<void>
  readonly dispatch: () => Effect.Effect<void>
  readonly retry: (id: string, destination?: "original" | "current") => Effect.Effect<void, Error>
  readonly record: (record: UsageReporter.Record) => Effect.Effect<boolean>
}
export class Service extends Context.Service<Service, Interface>()("@redcode/UsageReporter") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const credentials = yield* Credential.Service
    const mutex = yield* Semaphore.make(1)
    yield* db
      .insert(UsageReporterConfigTable)
      .values({
        id: "default",
        instance_id: randomUUID(),
        enabled: false,
        transport: "webhook",
        url: "",
        queue: "usage_events",
        since: 0,
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    const config = Effect.fn("UsageReporter.config")(function* () {
      return (yield* db
        .select()
        .from(UsageReporterConfigTable)
        .where(eq(UsageReporterConfigTable.id, "default"))
        .get()
        .pipe(Effect.orDie))!
    })
    const record = Effect.fn("UsageReporter.record")(function* (input: UsageReporter.Record) {
      // Encode only the canonical projection. Unknown fields are discarded even for internal producers.
      const value = Schema.decodeUnknownSync(UsageReporter.Record)(input)
      return yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const current = (yield* tx
              .select()
              .from(UsageReporterConfigTable)
              .where(eq(UsageReporterConfigTable.id, "default"))
              .get())!
            if (!current.enabled) return false
            yield* tx
              .insert(UsageReporterRecordTable)
              .values({ id: value.id, session_id: value.sessionID, created: Date.now(), data: value })
              .onConflictDoNothing()
              .run()
            yield* tx
              .insert(UsageReporterDeliveryTable)
              .values({
                id: value.id,
                status: "pending",
                next_attempt_at: Date.now(),
                destination: {
                  transport: current.transport,
                  url: current.url,
                  queue: current.queue,
                  credential_id: current.credential_id,
                },
              })
              .onConflictDoNothing()
              .run()
            return true
          }),
        )
        .pipe(Effect.orDie)
    })
    const messages = Effect.fn("UsageReporter.messages")(function* (sessionID: string, seq?: number) {
      return (
        (yield* db
          .get<typeof emptyMessages>(
            sql`
      SELECT count(*) AS total, coalesce(sum(type='user'),0) AS user, coalesce(sum(type='assistant'),0) AS assistant
      FROM session_message WHERE session_id=${sessionID} AND type IN ('user','assistant')
      ${seq === undefined ? sql`` : sql`AND seq <= ${seq}`}
    `,
          )
          .pipe(Effect.orDie)) ?? emptyMessages
      )
    })
    const collect = mutex.withPermit(
      Effect.gen(function* () {
        const current = yield* config()
        if (!current.enabled) return
        // No time/ID cursor: late commits are discoverable, and source identities dedupe replay.
        const events = yield* db
          .select()
          .from(EventTable)
          .where(
            and(
              inArray(EventTable.type, types),
              sql`${EventTable.created} >= ${current.since}`,
              sql`NOT EXISTS (SELECT 1 FROM usage_reporter_record WHERE id = 'source:' || ${EventTable.id})`,
            ),
          )
          .orderBy(asc(EventTable.created), asc(EventTable.id))
          .limit(200)
          .all()
          .pipe(Effect.orDie)
        for (const event of events) {
          const session = yield* db
            .select()
            .from(SessionTable)
            .where(sql`${SessionTable.id}=${event.aggregate_id}`)
            .get()
            .pipe(Effect.orDie)
          const definition = terminalEvents.find(
            (item) => Event.versionedType(item.type, item.durable.version) === event.type,
          )!
          const data = Schema.decodeUnknownSync(definition.data)(event.data)
          const messageID = "assistantMessageID" in data ? data.assistantMessageID : undefined
          const row = messageID
            ? yield* db
                .select()
                .from(SessionMessageTable)
                .where(eq(SessionMessageTable.id, messageID))
                .get()
                .pipe(Effect.orDie)
            : undefined
          const assistant =
            row?.type === "assistant"
              ? Option.getOrUndefined(
                  Schema.decodeUnknownOption(SessionMessage.Assistant)({ ...row.data, id: row.id, type: row.type }),
                )
              : undefined
          const observed = "tokens" in data ? (data.tokens ?? null) : null
          // The native runtime normalizes missing provider usage to zero. Do not advertise that as measured consumption.
          const tokens =
            observed &&
            observed.input + observed.output + observed.reasoning + observed.cache.read + observed.cache.write > 0
              ? observed
              : null
          const charge = "cost" in data ? (data.cost ?? null) : null
          const cost = !tokens && charge === 0 ? null : charge
          const started = assistant ? DateTime.toEpochMillis(assistant.time.created) : event.created
          const first = assistant?.time.first ? DateTime.toEpochMillis(assistant.time.first) : undefined
          const streamed = assistant?.time.streamed ? DateTime.toEpochMillis(assistant.time.streamed) : undefined
          const tools = assistant?.content.filter((item) => item.type === "tool") ?? []
          yield* record({
            ...base(current, session, event.aggregate_id),
            id: `source:${event.id}`,
            type: "model.usage.recorded",
            stage: messageID ? "s2" : "auxiliary",
            scope: "step",
            operation: "source" in data ? data.source : "generation",
            provider: assistant?.model.providerID ?? null,
            model: assistant?.model.id ?? null,
            messageID: messageID ?? null,
            messageSequence: row ? (yield* messages(event.aggregate_id, row.seq)).total : null,
            revision: null,
            usageRecords: 1,
            unknownUsageRecords: tokens ? 0 : 1,
            unpricedRecords: cost === null ? 1 : 0,
            retryCount: messageID
              ? ((yield* db
                  .get<{
                    count: number
                  }>(
                    sql`SELECT count(*) AS count FROM event WHERE aggregate_id=${event.aggregate_id} AND type=${Event.versionedType(SessionEvent.RetryScheduled.type, SessionEvent.RetryScheduled.durable.version)} AND seq<=${event.seq} AND json_extract(data,'$.assistantMessageID')=${messageID}`,
                  )
                  .pipe(Effect.orDie))?.count ?? 0)
              : null,
            messages: yield* messages(event.aggregate_id),
            status:
              "error" in data && data.error.type === "aborted"
                ? "cancelled"
                : definition === SessionEvent.Step.Failed
                  ? "failed"
                  : "succeeded",
            tokens,
            usageBasis: tokens ? "recorded" : "unknown",
            cost,
            pricingBasis: cost === null ? "unknown" : "recorded",
            startedAt: started,
            completedAt: event.created,
            durationMs: assistant ? Math.max(0, event.created - started) : null,
            firstOutputMs: first === undefined ? null : Math.max(0, first - started),
            streamDurationMs: streamed === undefined ? null : Math.max(0, streamed - started),
            tools: {
              calls: tools.length,
              succeeded: tools.filter((item) => item.state.status === "completed").length,
              failed: tools.filter((item) => item.state.status === "error").length,
              unfinished: tools.filter((item) => !["completed", "error"].includes(item.state.status)).length,
              durationMs: tools.reduce(
                (total, item) =>
                  total +
                  (item.time.completed
                    ? Math.max(
                        0,
                        DateTime.toEpochMillis(item.time.completed) -
                          DateTime.toEpochMillis(item.time.ran ?? item.time.created),
                      )
                    : 0),
                0,
              ),
            },
          })
        }
        const evaluations = yield* db
          .select()
          .from(IntelligenceEvaluationTable)
          .where(
            and(
              sql`${IntelligenceEvaluationTable.time_created} >= ${current.since}`,
              sql`${IntelligenceEvaluationTable.session_id} IS NOT NULL`,
              sql`NOT EXISTS (SELECT 1 FROM usage_reporter_record WHERE id = 'evaluation:' || ${IntelligenceEvaluationTable.id})`,
            ),
          )
          .orderBy(asc(IntelligenceEvaluationTable.time_created))
          .limit(200)
          .all()
          .pipe(Effect.orDie)
        for (const evaluation of evaluations) {
          if (!evaluation.session_id) continue
          const session = yield* db
            .select()
            .from(SessionTable)
            .where(sql`${SessionTable.id}=${evaluation.session_id}`)
            .get()
            .pipe(Effect.orDie)
          yield* record({
            ...base(current, session, evaluation.session_id),
            id: `evaluation:${evaluation.id}`,
            type: "model.usage.recorded",
            stage: "s1",
            scope: "evaluation",
            operation: "evaluation",
            provider: typeof evaluation.evaluator?.transport === "string" ? evaluation.evaluator.transport : null,
            model: evaluation.model || null,
            messageID: null,
            messageSequence: null,
            revision: null,
            usageRecords: 1,
            unknownUsageRecords: 0,
            unpricedRecords: evaluation.cost === null || evaluation.unpriced_cost ? 1 : 0,
            retryCount: null,
            messages: yield* messages(evaluation.session_id),
            status: evaluation.decision === "unavailable" ? "failed" : "succeeded",
            tokens: {
              input: evaluation.input_tokens,
              output: evaluation.output_tokens,
              reasoning: null,
              cache: { read: null, write: null },
            },
            usageBasis: "recorded",
            cost: evaluation.cost,
            pricingBasis: evaluation.cost === null || evaluation.unpriced_cost ? "unknown" : "reported",
            startedAt: evaluation.time_created,
            completedAt: evaluation.time_created + evaluation.duration,
            durationMs: evaluation.duration,
            firstOutputMs: null,
            streamDurationMs: null,
            tools: emptyTools,
          })
        }
        // Summaries have immutable revision identities. Consumers replace their session view, never sum it.
        const revision = sql<number>`coalesce((SELECT seq FROM event_sequence WHERE aggregate_id=${SessionTable.id}),0) + (SELECT count(*) FROM usage_reporter_record WHERE session_id=${SessionTable.id} AND json_extract(data,'$.type')='model.usage.recorded')`
        const sessions = yield* db
          .select({ session: SessionTable, revision })
          .from(SessionTable)
          .where(
            and(
              sql`EXISTS (SELECT 1 FROM usage_reporter_record WHERE session_id=${SessionTable.id})`,
              sql`NOT EXISTS (SELECT 1 FROM usage_reporter_record WHERE id='summary:' || ${SessionTable.id} || ':' || ${revision})`,
            ),
          )
          .orderBy(desc(SessionTable.time_updated))
          .limit(100)
          .all()
          .pipe(Effect.orDie)
        for (const row of sessions) {
          const session = row.session
          const totals = (yield* db
            .get<{
              records: number
              unknown: number
              unpriced: number
              input: number | null
              output: number | null
              reasoning: number | null
              read: number | null
              write: number | null
              cost: number | null
            }>(
              sql`
        SELECT count(*) AS records, coalesce(sum(json_extract(data,'$.unknownUsageRecords')),0) AS unknown,
          coalesce(sum(json_extract(data,'$.unpricedRecords')),0) AS unpriced,
          CASE WHEN count(json_extract(data,'$.tokens.input'))=count(*) THEN sum(json_extract(data,'$.tokens.input')) ELSE NULL END AS input,
          CASE WHEN count(json_extract(data,'$.tokens.output'))=count(*) THEN sum(json_extract(data,'$.tokens.output')) ELSE NULL END AS output,
          CASE WHEN count(json_extract(data,'$.tokens.reasoning'))=count(*) THEN sum(json_extract(data,'$.tokens.reasoning')) ELSE NULL END AS reasoning,
          CASE WHEN count(json_extract(data,'$.tokens.cache.read'))=count(*) THEN sum(json_extract(data,'$.tokens.cache.read')) ELSE NULL END AS read,
          CASE WHEN count(json_extract(data,'$.tokens.cache.write'))=count(*) THEN sum(json_extract(data,'$.tokens.cache.write')) ELSE NULL END AS write,
          sum(json_extract(data,'$.cost')) AS cost
        FROM usage_reporter_record WHERE session_id=${session.id} AND json_extract(data,'$.type')='model.usage.recorded'
      `,
            )
            .pipe(Effect.orDie))!
          yield* record({
            ...base(current, session, session.id),
            id: `summary:${session.id}:${row.revision}`,
            type: "session.summary.updated",
            stage: "session",
            scope: "session",
            operation: "summary",
            provider: null,
            model: null,
            messageID: null,
            messageSequence: null,
            messages: yield* messages(session.id),
            revision: row.revision,
            usageRecords: totals.records,
            unknownUsageRecords: totals.unknown,
            unpricedRecords: totals.unpriced,
            retryCount: null,
            status: session.time_suspended !== null ? "busy" : "idle",
            // Sum collected facts, including S1. Never bill inherited fork history or copied transcripts again.
            tokens: {
              input: totals.input,
              output: totals.output,
              reasoning: totals.reasoning,
              cache: { read: totals.read, write: totals.write },
            },
            usageBasis: totals.unknown ? "unknown" : "recorded",
            cost: totals.cost,
            pricingBasis: totals.unpriced ? "unknown" : "recorded",
            startedAt: session.time_created,
            completedAt: session.time_idle,
            durationMs: null,
            firstOutputMs: null,
            streamDurationMs: null,
            tools: null,
          })
        }
      }),
    )
    const snapshot = Effect.fn("UsageReporter.snapshot")(function* () {
      const current = yield* config()
      const counts = { pending: 0, delivered: 0, dead: 0 }
      const groups = yield* db
        .all<{
          status: UsageReporter.Delivery["status"]
          total: number
        }>(sql`SELECT status,count(*) AS total FROM usage_reporter_delivery GROUP BY status`)
        .pipe(Effect.orDie)
      groups.forEach((group) => (counts[group.status === "sending" ? "pending" : group.status] += group.total))
      const rows = yield* db
        .select()
        .from(UsageReporterDeliveryTable)
        .innerJoin(UsageReporterRecordTable, eq(UsageReporterRecordTable.id, UsageReporterDeliveryTable.id))
        .orderBy(desc(UsageReporterRecordTable.created))
        .limit(50)
        .all()
        .pipe(Effect.orDie)
      return {
        config: view(current),
        counts,
        deliveries: rows.map((row) => ({
          id: row.usage_reporter_delivery.id,
          status: row.usage_reporter_delivery.status,
          attempts: row.usage_reporter_delivery.attempts,
          nextAttemptAt: row.usage_reporter_delivery.next_attempt_at,
          httpStatus: row.usage_reporter_delivery.http_status,
          error: row.usage_reporter_delivery.error,
          record: row.usage_reporter_record.data,
        })),
      } satisfies UsageReporter.Snapshot
    })
    const configure = Effect.fn("UsageReporter.configure")(function* (input: UsageReporter.Configure) {
      const checked = yield* Effect.try({
        try: () => validate(input),
        catch: (error) => new Error(error instanceof Error ? error.message : "Invalid reporter configuration"),
      })
      const current = yield* config()
      const existing = current.credential_id
        ? yield* credentials.get(Credential.ID.make(current.credential_id))
        : undefined
      if (
        checked.enabled &&
        checked.transport === "webhook" &&
        !(checked.secret === undefined ? existing : checked.secret)
      )
        return yield* Effect.fail(new Error("A webhook signing secret is required"))
      const credentialID =
        checked.secret === undefined ? current.credential_id : checked.secret === "" ? null : Credential.ID.create()
      if (checked.secret) {
        yield* credentials.create({
          id: Credential.ID.make(credentialID!),
          integrationID: integration,
          label: "Usage reporter",
          value: { type: "key", key: checked.secret },
          activate: false,
        })
      }
      yield* db
        .update(UsageReporterConfigTable)
        .set({
          enabled: checked.enabled,
          transport: checked.transport,
          url: checked.url,
          queue: checked.queue,
          credential_id: credentialID,
          // Collection is opt-in. The original boundary survives pause/resume and process restart.
          since: current.since || (checked.enabled ? Date.now() : 0),
        })
        .where(eq(UsageReporterConfigTable.id, "default"))
        .run()
        .pipe(Effect.orDie)
      return yield* snapshot()
    })
    const dispatch = Effect.fn("UsageReporter.dispatch")(function* () {
      const current = yield* config()
      if (!current.enabled) return
      const due = yield* db
        .select()
        .from(UsageReporterDeliveryTable)
        .where(
          or(
            and(
              eq(UsageReporterDeliveryTable.status, "pending"),
              lte(UsageReporterDeliveryTable.next_attempt_at, Date.now()),
            ),
            and(
              eq(UsageReporterDeliveryTable.status, "sending"),
              lte(UsageReporterDeliveryTable.lease_until, Date.now()),
            ),
          ),
        )
        .orderBy(asc(UsageReporterDeliveryTable.next_attempt_at))
        .limit(25)
        .all()
        .pipe(Effect.orDie)
      for (const delivery of due) {
        if (!(yield* config()).enabled) break
        const lease = randomUUID()
        const claimed = yield* db
          .update(UsageReporterDeliveryTable)
          .set({
            status: "sending",
            lease,
            lease_until: Date.now() + 30_000,
            attempts: sql`${UsageReporterDeliveryTable.attempts}+1`,
          })
          .where(
            and(
              eq(UsageReporterDeliveryTable.id, delivery.id),
              or(
                and(
                  eq(UsageReporterDeliveryTable.status, "pending"),
                  lte(UsageReporterDeliveryTable.next_attempt_at, Date.now()),
                ),
                and(
                  eq(UsageReporterDeliveryTable.status, "sending"),
                  lte(UsageReporterDeliveryTable.lease_until, Date.now()),
                ),
              ),
            ),
          )
          .returning()
          .get()
          .pipe(Effect.orDie)
        if (!claimed) continue
        const stored = claimed.destination.credential_id
          ? yield* credentials.get(Credential.ID.make(claimed.destination.credential_id))
          : undefined
        const secret = stored?.value.type === "key" ? stored.value.key : undefined
        const fact = yield* db
          .select()
          .from(UsageReporterRecordTable)
          .where(eq(UsageReporterRecordTable.id, delivery.id))
          .get()
          .pipe(Effect.orDie)
        const result = yield* Effect.tryPromise({
          try: () => send(claimed.destination, secret, fact!.data),
          catch: () => new Error("Delivery failed"),
        }).pipe(
          Effect.catch(() => Effect.succeed({ ok: false, status: null, error: "network" as const, permanent: false })),
        )
        const dead = !result.ok && (result.permanent || claimed.attempts >= 9)
        yield* db
          .update(UsageReporterDeliveryTable)
          .set({
            status: result.ok ? "delivered" : dead ? "dead" : "pending",
            http_status: result.status,
            error: result.ok ? null : result.error,
            lease: null,
            lease_until: null,
            next_attempt_at: Date.now() + Math.min(28_800, 30 * 2 ** (claimed.attempts - 1)) * 1000,
          })
          .where(and(eq(UsageReporterDeliveryTable.id, delivery.id), eq(UsageReporterDeliveryTable.lease, lease)))
          .run()
          .pipe(Effect.orDie)
      }
    })
    const retry = Effect.fn("UsageReporter.retry")(function* (
      id: string,
      destination: "original" | "current" = "original",
    ) {
      const current = yield* config()
      const target =
        destination === "current"
          ? {
              transport: current.transport,
              url: current.url,
              queue: current.queue,
              credential_id: current.credential_id,
            }
          : undefined
      if (target && !current.url) return yield* Effect.fail(new Error("Configure a destination before retrying"))
      const updated = yield* db
        .update(UsageReporterDeliveryTable)
        .set({
          status: "pending",
          attempts: 0,
          next_attempt_at: Date.now(),
          lease: null,
          lease_until: null,
          ...(target ? { destination: target } : {}),
        })
        .where(
          and(
            eq(UsageReporterDeliveryTable.id, id),
            or(
              inArray(UsageReporterDeliveryTable.status, ["pending", "dead"]),
              and(
                eq(UsageReporterDeliveryTable.status, "sending"),
                lte(UsageReporterDeliveryTable.lease_until, Date.now()),
              ),
            ),
          ),
        )
        .returning()
        .get()
        .pipe(Effect.orDie)
      if (!updated) return yield* Effect.fail(new Error("Delivery is missing, already delivered or currently sending"))
    })
    const tick = collect.pipe(
      Effect.andThen(dispatch),
      Effect.catchCause(() => Effect.logWarning("Usage reporter tick failed")),
    )
    yield* tick.pipe(
      Effect.andThen(Effect.sleep("5 seconds")),
      Effect.forever,
      Effect.forkScoped({ startImmediately: true }),
    )
    return Service.of({
      configuration: () => config().pipe(Effect.map(view)),
      snapshot,
      configure,
      collect: () => collect,
      dispatch,
      retry,
      record,
    })
  }),
)

function view(config: Config): UsageReporter.Config {
  return {
    enabled: config.enabled,
    transport: config.transport,
    url: config.url,
    queue: config.queue,
    secretConfigured: config.credential_id !== null,
    instanceID: config.instance_id,
    since: config.since,
  }
}
function base(config: Config, session: SessionRow | undefined, sessionID: string) {
  return {
    version: 1 as const,
    instanceID: config.instance_id,
    sessionID,
    nativeSessionID: null,
    parentSessionID: session?.parent_id ?? null,
    projectID: session?.project_id ?? null,
    workspaceID: session?.workspace_id ?? null,
    source: "native" as const,
    coverage: "own_session" as const,
    currency: "USD" as const,
  }
}
export function validate(input: UsageReporter.Configure) {
  const checked = Schema.decodeUnknownSync(UsageReporter.Configure)(input)
  if (!checked.url && !checked.enabled) return checked
  const url = new URL(checked.url)
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))
  )
    throw new Error("Use an HTTPS URL or loopback HTTP, without credentials, query or fragment")
  if (checked.transport === "webhook" && checked.secret !== undefined && checked.secret.length < 16)
    throw new Error("Webhook signing secrets require at least 16 characters")
  if (
    checked.transport === "webhook" &&
    checked.secret?.startsWith("whsec_") &&
    (!/^[A-Za-z0-9+/]+={0,2}$/.test(checked.secret.slice(6)) ||
      Buffer.from(checked.secret.slice(6), "base64").length < 16)
  )
    throw new Error("Encoded webhook signing secrets require at least 16 decoded bytes")
  return { ...checked, url: url.href }
}
async function send(config: Destination, secret: string | undefined, record: UsageReporter.Record) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "Redcode-UsageReporter/1",
    "idempotency-key": record.id,
  }
  const body = JSON.stringify(record)
  if (config.transport === "webhook") {
    if (!secret) return { ok: false, status: null, error: "configuration" as const, permanent: true }
    const timestamp = String(Math.floor(Date.now() / 1000))
    headers["webhook-id"] = record.id
    headers["webhook-timestamp"] = timestamp
    headers["webhook-signature"] = `v1,${createHmac(
      "sha256",
      secret.startsWith("whsec_") ? Buffer.from(secret.slice(6), "base64") : secret,
    )
      .update(`${record.id}.${timestamp}.${body}`)
      .digest("base64")}`
  } else if (secret) headers.authorization = `Bearer ${secret}`
  const response = await fetch(
    config.transport === "webhook" ? config.url : `${config.url.replace(/\/+$/, "")}/query`,
    {
      method: "POST",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      body:
        config.transport === "webhook"
          ? body
          : JSON.stringify({ query: `QUEUE PUSH ${config.queue} ${body} DEDUP '${record.id.replace(/'/g, "''")}'` }),
    },
  )
  const valid =
    config.transport === "reddb" && response.ok
      ? await response
          .json()
          .then((value: unknown) => typeof value === "object" && value !== null && "ok" in value && value.ok === true)
          .catch(() => false)
      : response.ok
  await response.body?.cancel().catch(() => {})
  return {
    ok: valid,
    status: response.status,
    error: "http" as const,
    permanent: [400, 401, 403, 404, 410, 413, 422].includes(response.status),
  }
}
export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, Credential.node] })
