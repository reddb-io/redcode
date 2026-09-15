/**
 * A scripted OpenAI-compatible chat completions server: the provider every replayed eval talks to.
 *
 * A cassette is the model's side of a run, step by step. Values only known at run time (the
 * workspace, the plan file, a todo's id and revision) are written as `{{name}}` templates and
 * resolved when the request that consumes the step arrives, so the same cassette replays in any
 * temp directory. A request with no step left is answered with HTTP 400 and marks the run as
 * crashed: a harness change that makes the model take an extra step must fail loudly, not loop.
 */
import fs from "node:fs"
import path from "node:path"
import type { ProviderRequest } from "./record"

export interface ScriptToolCall {
  readonly name: string
  readonly input: unknown
}

export interface Step {
  /** Consume this step only for a request whose JSON body contains this text. */
  readonly match?: string
  readonly reasoning?: string
  readonly text?: string
  readonly tools?: readonly ScriptToolCall[]
  /** Omitted: the provider reports no usage, as a model that stops mid-stream does. */
  readonly usage?: { readonly input: number; readonly output: number }
  readonly error?: { readonly status: number; readonly message: string }
}

export interface Cassette {
  readonly version: 1
  readonly name: string
  /** Where the steps came from: `hand-written`, or the live model a recording was made with. */
  readonly source: string
  readonly steps: readonly Step[]
}

export type Resolve = (name: string) => Promise<string> | string

const TITLE = "Generate a title for this conversation"

export interface ScriptedProvider {
  readonly url: string
  readonly requests: () => ProviderRequest[]
  /** Script steps no request consumed. */
  readonly pending: () => number
  readonly exhausted: () => string | undefined
  /** Sizes of each step's request and answer, for pilot estimates. */
  readonly exchanges: () => { requestBytes: number; responseBytes: number }[]
  readonly stop: () => void
}

export function start(input: { cassette: Cassette; resolve: Resolve; model?: string }): ScriptedProvider {
  const queue = input.cassette.steps.map((step, index) => ({ step, index }))
  const requests: ProviderRequest[] = []
  const exchanges: { requestBytes: number; responseBytes: number }[] = []
  let exhausted: string | undefined

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    fetch: async (req) => {
      const url = new URL(req.url)
      if (req.method !== "POST" || !url.pathname.endsWith("/chat/completions"))
        return Response.json({ error: { message: `unexpected ${req.method} ${url.pathname}` } }, { status: 404 })
      const raw = await req.text()
      const body = parseBody(raw)
      const tools = Array.isArray(body.tools) ? body.tools.map((tool: any) => String(tool?.function?.name)) : []
      const base = { index: requests.length, bytes: Buffer.byteLength(raw), tools }
      if (raw.includes(TITLE)) {
        requests.push({ ...base, kind: "title" })
        return stream({ text: "Eval run", usage: { input: 1, output: 1 } }, input.model)
      }
      const found = queue.findIndex((entry) => !entry.step.match || raw.includes(entry.step.match))
      if (found < 0) {
        requests.push({ ...base, kind: "miss" })
        exhausted ??= `the script has no step for request ${requests.length} (${queue.length} unmatched steps left)`
        return Response.json({ error: { message: `eval script exhausted: ${exhausted}` } }, { status: 400 })
      }
      const [{ step, index }] = queue.splice(found, 1)
      requests.push({ ...base, kind: "step", step: index })
      if (step.error) return Response.json({ error: { message: step.error.message } }, { status: step.error.status })
      // A template that cannot resolve (a todo the run never created) means the trajectory went
      // off script: answer with a non-retryable error and let the run end as crashed, with why.
      const resolved = await resolveStep(step, input.resolve).catch((error: unknown) => {
        exhausted ??= `script step ${index + 1} could not be resolved: ${error instanceof Error ? error.message : String(error)}`
        return undefined
      })
      if (!resolved) return Response.json({ error: { message: `eval script failed: ${exhausted}` } }, { status: 400 })
      exchanges.push({ requestBytes: base.bytes, responseBytes: answerBytes(resolved) })
      return stream(resolved, input.model)
    },
  })

  return {
    url: `http://127.0.0.1:${server.port}/v1`,
    requests: () => [...requests],
    pending: () => queue.length,
    exhausted: () => exhausted,
    exchanges: () => [...exchanges],
    stop: () => void server.stop(true),
  }
}

function parseBody(raw: string): Record<string, any> {
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

const TEMPLATE = /\{\{([a-zA-Z0-9_.:-]+)\}\}/g

export async function template(value: string, resolve: Resolve) {
  const names = [...new Set([...value.matchAll(TEMPLATE)].map((match) => match[1]!))]
  if (!names.length) return value
  const values = new Map<string, string>()
  for (const name of names) values.set(name, await resolve(name))
  return value.replace(TEMPLATE, (_, name: string) => values.get(name)!)
}

async function deep(value: unknown, resolve: Resolve): Promise<unknown> {
  if (typeof value === "string") {
    // A whole-value number template (`"{{todo.0.revision}}"`) becomes a number again.
    const whole = value.match(/^\{\{([a-zA-Z0-9_.:-]+)\}\}$/)
    const out = await template(value, resolve)
    return whole && /^-?\d+$/.test(out) ? Number(out) : out
  }
  if (Array.isArray(value)) return Promise.all(value.map((item) => deep(item, resolve)))
  if (value && typeof value === "object")
    return Object.fromEntries(
      await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await deep(item, resolve)] as const)),
    )
  return value
}

async function resolveStep(step: Step, resolve: Resolve): Promise<Step> {
  return {
    ...step,
    ...(step.text !== undefined ? { text: await template(step.text, resolve) } : {}),
    ...(step.tools
      ? { tools: await Promise.all(step.tools.map(async (tool) => ({ name: tool.name, input: await deep(tool.input, resolve) }))) }
      : {}),
  }
}

function answerBytes(step: Step) {
  return Buffer.byteLength((step.reasoning ?? "") + (step.text ?? "") + JSON.stringify(step.tools ?? []))
}

function chunk(delta: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return `data: ${JSON.stringify({
    id: "chatcmpl-eval",
    object: "chat.completion.chunk",
    created: 0,
    model: "scripted",
    choices: [{ index: 0, delta, ...extra }],
  })}\n\n`
}

export function sse(step: Step) {
  const lines = [chunk({ role: "assistant" })]
  if (step.reasoning) lines.push(chunk({ reasoning_content: step.reasoning }))
  if (step.text) lines.push(chunk({ content: step.text }))
  step.tools?.forEach((tool, index) => {
    const id = `call_${index}_${Math.random().toString(36).slice(2, 10)}`
    lines.push(chunk({ tool_calls: [{ index, id, type: "function", function: { name: tool.name, arguments: "" } }] }))
    lines.push(chunk({ tool_calls: [{ index, function: { arguments: JSON.stringify(tool.input ?? {}) } }] }))
  })
  const finish = step.tools?.length ? "tool_calls" : "stop"
  const usage = step.usage
    ? {
        usage: {
          prompt_tokens: step.usage.input,
          completion_tokens: step.usage.output,
          total_tokens: step.usage.input + step.usage.output,
        },
      }
    : {}
  lines.push(
    `data: ${JSON.stringify({
      id: "chatcmpl-eval",
      object: "chat.completion.chunk",
      created: 0,
      model: "scripted",
      choices: [{ index: 0, delta: {}, finish_reason: finish }],
      ...usage,
    })}\n\n`,
  )
  lines.push("data: [DONE]\n\n")
  return lines.join("")
}

function stream(step: Step, _model?: string) {
  return new Response(sse(step), { headers: { "content-type": "text/event-stream" } })
}

export const CASSETTES = path.join(import.meta.dir, "..", "cassettes")

export function load(name: string, dir = CASSETTES): Cassette {
  const file = path.join(dir, `${name}.json`)
  if (!fs.existsSync(file)) throw new Error(`no cassette at ${file}`)
  const cassette = JSON.parse(fs.readFileSync(file, "utf8")) as Cassette
  if (cassette.version !== 1 || !Array.isArray(cassette.steps)) throw new Error(`${file} is not a version 1 cassette`)
  return cassette
}

export function save(cassette: Cassette, dir = CASSETTES) {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${cassette.name}.json`)
  fs.writeFileSync(file, JSON.stringify(cassette, null, 2) + "\n")
  return file
}

/** Turns a live run's assistant steps into a cassette that replays the same trajectory. */
export function fromMessages(name: string, source: string, messages: readonly { info: any; parts: any[] }[]): Cassette {
  const steps: Step[] = []
  for (const message of messages) {
    if (message.info.role !== "assistant") continue
    const text = message.parts
      .filter((part) => part.type === "text" && !part.synthetic)
      .map((part) => part.text)
      .join("")
    const tools = message.parts
      .filter((part) => part.type === "tool")
      .map((part) => ({ name: String(part.tool), input: part.state?.input ?? {} }))
    const finish = message.parts.find((part) => part.type === "step-finish")
    steps.push({
      ...(text ? { text } : {}),
      ...(tools.length ? { tools } : {}),
      ...(finish ? { usage: { input: finish.tokens?.input ?? 0, output: finish.tokens?.output ?? 0 } } : {}),
    })
  }
  return { version: 1, name, source, steps }
}

export * as ScriptedProvider from "./scripted-provider"
