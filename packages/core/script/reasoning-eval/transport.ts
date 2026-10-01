import { Option, Schema } from "effect"

const Model = Schema.Struct({ model: Schema.optional(Schema.String) })
const Cost = Schema.Struct({
  model: Schema.optional(Schema.String),
  usage: Schema.optional(
    Schema.Struct({ cost: Schema.optional(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))) }),
  ),
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
}

/** Streaming usage is cumulative: use the last reported cost, never add frames together. */
export function observedCost(text: string) {
  const frames = text.includes("data:")
    ? text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
    : [text]
  return frames
    .flatMap((frame) => {
      const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Cost))(frame)
      return Option.isSome(decoded) && decoded.value.model !== "keepalive" && decoded.value.usage?.cost !== undefined
        ? [decoded.value.usage.cost]
        : []
    })
    .at(-1)
}

export function observedModels(text: string) {
  const lines =
    text.trimStart().startsWith("data:") || text.includes("\ndata:")
      ? text
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
      : [text]
  return [
    ...new Set(
      lines.flatMap((line) => {
        const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Model))(line)
        return Option.isSome(decoded) && decoded.value.model && decoded.value.model !== "keepalive"
          ? [decoded.value.model]
          : []
      }),
    ),
  ]
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
