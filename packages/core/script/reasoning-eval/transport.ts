import { Option, Schema } from "effect"

const Model = Schema.Struct({ model: Schema.optional(Schema.String) })
const Cost = Schema.Struct({
  cost: Schema.optional(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
})
const Tokens = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Usage = Schema.Union([
  Schema.Struct({ prompt_tokens: Tokens, completion_tokens: Tokens }),
  Schema.Struct({ input_tokens: Tokens, output_tokens: Tokens }),
])
const ResponseBody = Schema.Struct({
  model: Schema.optional(Schema.String),
  usage: Schema.optional(Schema.Unknown),
})
const ResponseFrame = Schema.Struct({
  ...ResponseBody.fields,
  type: Schema.optional(Schema.String),
  response: Schema.optional(ResponseBody),
})

export interface RequestMetric {
  run: string
  path: string
  method: string
  model?: string
  status: number
  headersMs: number | null
  firstByteMs: number | null
  durationMs: number | null
  bytes: number
  complete: boolean
  responseModels: string[]
  costUsd?: number
  usageKnown?: boolean
}

/** Streaming usage is cumulative: use the last reported cost, never add frames together. */
export function observedCost(text: string) {
  return frames(text)
    .flatMap((frame) => {
      const body = frame.response ?? frame
      if (body.model === "keepalive" || frame.type === "response.created") return []
      const decoded = Schema.decodeUnknownOption(Cost)(body.usage)
      return Option.isSome(decoded) && decoded.value.cost !== undefined ? [decoded.value.cost] : []
    })
    .at(-1)
}

/** The final usage payload must contain both token counts; separate partial frames are not totals. */
export function observedUsage(text: string) {
  const usage = frames(text)
    .flatMap((frame) => {
      const body = frame.response ?? frame
      if (body.model === "keepalive" || body.usage === undefined) return []
      if (frame.response && frame.type !== "response.completed") return []
      return [body.usage]
    })
    .at(-1)
  return Option.isSome(Schema.decodeUnknownOption(Usage)(usage))
}

export function observedModels(text: string) {
  return [
    ...new Set(
      frames(text).flatMap((frame) => {
        const body = frame.response ?? frame
        return body.model && body.model !== "keepalive" ? [body.model] : []
      }),
    ),
  ]
}

/** Chat and decision bodies are top-level; Responses stream events wrap the same facts in response. */
function frames(text: string) {
  const lines =
    text.trimStart().startsWith("data:") || text.includes("\ndata:")
      ? text
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
      : [text]
  return lines.flatMap((line) => {
    const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(ResponseFrame))(line)
    return Option.isSome(decoded) ? [decoded.value] : []
  })
}

export function proxy(baseURL: string, current: { run: string }, metrics: RequestMetric[]) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const started = performance.now()
      const body = request.method === "GET" ? undefined : await request.text()
      const decoded = body ? Schema.decodeUnknownOption(Schema.fromJsonString(Model))(body) : Option.none()
      const metric: RequestMetric = {
        run: current.run,
        path: new URL(request.url).pathname + new URL(request.url).search,
        method: request.method,
        ...(Option.isSome(decoded) && decoded.value.model ? { model: decoded.value.model } : {}),
        status: 0,
        headersMs: null,
        firstByteMs: null,
        durationMs: null,
        bytes: 0,
        complete: false,
        responseModels: [],
        usageKnown: false,
      }
      metrics.push(metric)
      const headers = new Headers(request.headers)
      headers.delete("host")
      const response = await fetch(new URL(metric.path, new URL(baseURL).origin), {
        method: request.method,
        headers,
        body,
        redirect: "error",
        signal: request.signal,
      }).catch(() => undefined)
      if (!response) {
        metric.status = 502
        metric.durationMs = performance.now() - started
        metric.complete = true
        return new Response("Upstream connection failed", { status: 502 })
      }
      metric.status = response.status
      metric.headersMs = performance.now() - started
      const chunks: string[] = []
      const decoder = new TextDecoder()
      const output = new Headers(response.headers)
      output.delete("content-length")
      output.delete("content-encoding")
      return new Response(
        response.body?.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              metric.firstByteMs ??= performance.now() - started
              metric.bytes += chunk.byteLength
              chunks.push(decoder.decode(chunk, { stream: true }))
              controller.enqueue(chunk)
            },
            flush() {
              chunks.push(decoder.decode())
              metric.responseModels = observedModels(chunks.join(""))
              metric.costUsd = observedCost(chunks.join(""))
              metric.usageKnown = observedUsage(chunks.join(""))
              metric.durationMs = performance.now() - started
              metric.complete = true
            },
          }),
        ),
        { status: response.status, headers: output },
      )
    },
  })
}
