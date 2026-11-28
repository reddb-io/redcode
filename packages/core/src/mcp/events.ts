export * as McpEvents from "./events.js"

import { createHash } from "node:crypto"
import { AsyncLocalStorage } from "node:async_hooks"
import type { Client, Transport } from "@modelcontextprotocol/client"
import { Cause, Effect, Option, Queue, Schema, Stream } from "effect"
import { codecFor } from "../tool/runtime.js"

export const extension = "io.modelcontextprotocol/events"
const subscriptionID = "io.modelcontextprotocol/subscriptionId"
const cursor = Schema.optional(Schema.NullOr(Schema.String.check(Schema.isMaxLength(8192))))
const subscription = { _meta: Schema.Struct({ [subscriptionID]: Schema.Union([Schema.String, Schema.Number]) }) }
const position = { cursor, ...subscription }
const checkpoint = Schema.toStandardSchemaV1(Schema.Struct(position))
const active = Schema.toStandardSchemaV1(
  Schema.Struct({
    ...position,
    heartbeatMs: Schema.Int.check(Schema.isGreaterThan(0)),
    truncated: Schema.optional(Schema.Boolean),
  }),
)
const notification = Schema.toStandardSchemaV1(
  Schema.Struct({
    ...position,
    eventId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
    name: Schema.String,
    timestamp: Schema.String,
    data: Schema.Record(Schema.String, Schema.Json),
  }),
)
const error = Schema.toStandardSchemaV1(
  Schema.Struct({
    ...subscription,
    error: Schema.Struct({ code: Schema.Int, message: Schema.String }),
  }),
)
const catalog = Schema.toStandardSchemaV1(
  Schema.Struct({
    events: Schema.Array(Schema.Unknown),
    nextCursor: Schema.optional(Schema.String),
  }),
)
const decodeType = Schema.decodeUnknownOption(
  Schema.Struct({
    name: Schema.String,
    description: Schema.optional(Schema.String),
    delivery: Schema.Array(Schema.String),
    inputSchema: Schema.Record(Schema.String, Schema.Unknown),
    payloadSchema: Schema.Record(Schema.String, Schema.Unknown),
  }),
)
const complete = Schema.toStandardSchemaV1(Schema.Unknown)

export type Request = { name: string; arguments?: Readonly<Record<string, Schema.Json>> }
export type Definition = { name: string; description?: string }
export type Position = { cursor: string | null; truncated?: boolean; eventID?: string }

const match = (schema: Record<string, unknown>) => {
  const codec = codecFor(schema)
  if (!codec) return undefined
  const decode = Schema.decodeUnknownOption(codec, { onExcessProperty: "error" })
  return (value: unknown) => Option.isSome(decode(value))
}

export function identity(parts: readonly unknown[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex")
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// Correlate the SDK-assigned request ID before the transport can receive notifications.
export function tracker() {
  const active = new AsyncLocalStorage<(id: string) => void>()
  return {
    observe(transport: Transport) {
      const send = transport.send.bind(transport)
      transport.send = (message, options) => {
        if ("method" in message && message.method === "events/stream" && "id" in message)
          active.getStore()?.(String(message.id))
        return send(message, options)
      }
    },
    request: <A>(remember: (id: string) => void, send: () => Promise<A>) => active.run(remember, send),
    close: () => active.disable(),
  }
}

export function make(client: Client, timeout: number, tracking: ReturnType<typeof tracker>) {
  if (client.getProtocolEra() !== "modern" || !client.getServerCapabilities()?.extensions?.[extension]) return undefined
  type Subscription = {
    queue: Queue.Queue<Position, Error | Cause.Done>
    heard: Queue.Queue<void>
    idle: number
    name: string
    matches: (data: unknown) => boolean
  }
  const streams = new Map<string, Subscription>()
  const streamFor = (params: typeof subscription._meta.Type) => streams.get(String(params[subscriptionID]))
  const emit = (open: Subscription, value: Position) => {
    if (!Queue.offerUnsafe(open.queue, value))
      Queue.failCauseUnsafe(
        open.queue,
        Cause.fail(new Error("MCP event stream exceeded its pending notification capacity")),
      )
  }
  client.setNotificationHandler("notifications/events/active", { params: active }, (params) => {
    const open = streamFor(params._meta)
    if (!open) return
    open.idle = params.heartbeatMs * 3
    Queue.offerUnsafe(open.heard, undefined)
    emit(open, { cursor: params.cursor ?? null, truncated: params.truncated })
  })
  client.setNotificationHandler("notifications/events/heartbeat", { params: checkpoint }, (params) => {
    const open = streamFor(params._meta)
    if (!open) return
    Queue.offerUnsafe(open.heard, undefined)
    if (params.cursor !== undefined) emit(open, { cursor: params.cursor })
  })
  client.setNotificationHandler("notifications/events/event", { params: notification }, (params) => {
    const open = streamFor(params._meta)
    if (!open) return
    Queue.offerUnsafe(open.heard, undefined)
    if (params.name !== open.name || !Number.isFinite(Date.parse(params.timestamp)) || !open.matches(params.data))
      return
    emit(open, { eventID: params.eventId, cursor: params.cursor ?? null })
  })
  client.setNotificationHandler("notifications/events/error", { params: error }, (params) => {
    const open = streamFor(params._meta)
    if (open) Queue.offerUnsafe(open.heard, undefined)
  })
  client.setNotificationHandler("notifications/events/terminated", { params: error }, (params) => {
    const open = streamFor(params._meta)
    if (open)
      Queue.failCauseUnsafe(open.queue, Cause.fail(new Error(`MCP subscription terminated (${params.error.code})`)))
  })
  const list = Effect.fnUntraced(function* () {
    const items = []
    let next: string | undefined
    for (let page = 0; page < 32; page++) {
      const result = yield* Effect.tryPromise({
        try: (signal) =>
          client.request({ method: "events/list", params: next === undefined ? {} : { cursor: next } }, catalog, {
            signal,
            timeout,
          }),
        catch: (cause) => new Error("Could not list MCP events", { cause }),
      })
      for (const item of result.events) {
        const entry = decodeType(item)
        if (Option.isNone(entry) || !entry.value.delivery.includes("push")) continue
        const accepts = match(entry.value.inputSchema)
        const matches = match(entry.value.payloadSchema)
        if (accepts && matches) items.push({ ...entry.value, accepts, matches })
      }
      if (result.nextCursor === undefined) return items
      if (result.nextCursor === next) break
      next = result.nextCursor
    }
    return yield* Effect.fail(new Error("MCP event catalog pagination did not finish"))
  })
  const check = Effect.fnUntraced(function* (input: Request) {
    const entry = (yield* list()).find((item) => item.name === input.name)
    if (!entry) return yield* Effect.fail(new Error(`MCP server does not offer push delivery for "${input.name}"`))
    if (!entry.accepts(input.arguments ?? {}))
      return yield* Effect.fail(new Error(`MCP subscription arguments do not match the schema for "${input.name}"`))
    return entry
  })
  return {
    list: () =>
      list().pipe(
        Effect.map((entries) =>
          entries.map(
            (entry): Definition => ({
              name: entry.name,
              description: entry.description,
            }),
          ),
        ),
      ),
    check: (input: Request) => check(input).pipe(Effect.asVoid),
    stream: (input: Request & { cursor: string | null }) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const entry = yield* check(input)
          const open: Subscription = {
            queue: yield* Queue.dropping<Position, Error | Cause.Done>(64),
            heard: yield* Queue.sliding<void>(1),
            idle: 90_000,
            name: input.name,
            matches: entry.matches,
          }
          let key: string | undefined
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (key !== undefined) streams.delete(key)
            }),
          )
          yield* Effect.tryPromise({
            try: (signal) =>
              tracking.request(
                (id) => {
                  if (key !== undefined) streams.delete(key)
                  key = id
                  streams.set(id, open)
                },
                () =>
                  client.request(
                    {
                      method: "events/stream",
                      params: { ...input, ...(input.cursor === null ? {} : { maxAgeMs: 3_600_000 }) },
                    },
                    complete,
                    {
                      signal,
                      // The SDK installs a JS timer. The heartbeat watchdog owns connection loss detection.
                      timeout: 2_147_483_647,
                      headers: headers(entry.inputSchema, input.arguments ?? {}),
                    },
                  ),
              ),
            catch: (cause) => new Error("MCP event stream disconnected", { cause }),
          }).pipe(
            Effect.matchEffect({
              onSuccess: () => Queue.end(open.queue),
              onFailure: (error) => Queue.failCause(open.queue, Cause.fail(error)),
            }),
            Effect.forkScoped,
          )
          yield* Effect.suspend(() => Queue.take(open.heard).pipe(Effect.timeout(open.idle))).pipe(
            Effect.forever,
            Effect.catch(() =>
              Queue.failCause(open.queue, Cause.fail(new Error("MCP event stream missed its heartbeat"))),
            ),
            Effect.forkScoped,
          )
          return Stream.fromQueue(open.queue)
        }),
      ),
  }
}

function headers(schema: Record<string, unknown>, values: Readonly<Record<string, Schema.Json>>) {
  const result: Record<string, string> = {}
  const walk = (node: Record<string, unknown>, data: Readonly<Record<string, unknown>>) => {
    if (!isRecord(node.properties)) return
    for (const [key, property] of Object.entries(node.properties)) {
      if (!isRecord(property) || !Object.hasOwn(data, key)) continue
      const value = data[key]
      const name = property["x-mcp-header"]
      if (
        typeof name === "string" &&
        /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) &&
        (typeof value === "string" || typeof value === "boolean" || Number.isSafeInteger(value))
      ) {
        const text = String(value)
        const plain =
          text !== "" && text === text.trim() && /^[\t\x20-\x7e]*$/.test(text) && !/^=\?base64\?.*\?=$/.test(text)
        result[`Mcp-Param-${name}`] = plain ? text : `=?base64?${Buffer.from(text).toString("base64")}?=`
      }
      if (isRecord(value)) walk(property, value)
    }
  }
  walk(schema, values)
  return result
}
