import { Service, type Endpoint } from "@opencode/client/effect/service"
import {
  OpenCode,
  type ModelRef,
  type OpenCodeClient,
  type SessionMessageAssistantTool,
} from "@opencode/client/promise"
import { FSUtil } from "@opencode/util/fs-util"
import { SessionBudget } from "@opencode/schema/session-budget"
import { open } from "node:fs/promises"
import path from "node:path"
import { readStdin } from "../util/io"
import { ServerConnection } from "../services/server-connection"
import { parseSessionTargetModel, resolveSessionTarget } from "../session-target"
import { toolInlineInfo } from "@opencode/tui/mini/tool"
import { runNonInteractivePrompt } from "./noninteractive"
import { UI } from "./ui"
import { Env } from "../env"
import { errorMessage } from "../util/error"

export type RunCommandInput = {
  server: ServerConnection.Resolved
  message: string[]
  continue?: boolean
  session?: string
  fork?: boolean
  model?: string
  agent?: string
  format: "default" | "json"
  file: string[]
  title?: string
  thinking?: boolean
  /** `--max-cost`: a session spend limit in US dollars, set by the person running the command. */
  maxCost?: string
  /** `--max-tokens`: a session token limit, such as 500k. */
  maxTokens?: string
  auto?: boolean
}

type FilePart = {
  url: string
  filename: string
  mime: string
}

type Prepared = {
  directory?: string
  message: string
  files: FilePart[]
}

type ExecutionOptions = {
  root?: string
  directory?: string
  useServerDirectory?: boolean
  variant?: string
  attached?: boolean
  compatibility?: "v1"
}

class RunTargetError extends Error {
  constructor(
    message: string,
    readonly sessionID?: string,
  ) {
    super(message)
  }
}

const ATTACH_FILE_MAX_BYTES = 10 * 1024 * 1024

export const NO_PROVIDER_MESSAGE =
  "No provider connected. Run `redcode` and use /connect, or set a provider key such as ANTHROPIC_API_KEY or OPENAI_API_KEY."

export function runNonInteractive(input: RunCommandInput) {
  return runNonInteractiveWithOptions(input, {})
}

/** @internal Used only by the V1 command boundary. */
export function runNonInteractiveWithOptions(input: RunCommandInput, options: ExecutionOptions) {
  return run(input, options).catch((error) => reportRunError(input, errorMessage(error)))
}

async function run(input: RunCommandInput, options: ExecutionOptions) {
  if (input.fork && !input.continue && !input.session) fail("--fork requires --continue or --session")
  // Parsed before anything runs, so a mistyped limit never starts an unlimited run.
  budgetLimits(input)
  const root = options.root ?? process.env.PWD ?? process.cwd()
  const local = localDirectory(root)
  const directory = options.useServerDirectory ? undefined : (options.directory ?? local)
  const message = mergeInput(formatMessage(input.message), process.stdin.isTTY ? undefined : await readStdin())
  if (!message?.trim()) fail("You must provide a message")
  const files = await Promise.all(input.file.map((file) => prepareFile(file, root, options)))
  const prepared = { directory, message, files }
  return execute(input, prepared, input.server.endpoint, options)
}

async function execute(input: RunCommandInput, prepared: Prepared, endpoint: Endpoint, options: ExecutionOptions) {
  const client = OpenCode.make({
    baseUrl: endpoint.url,
    headers: Service.headers(endpoint),
    // Bun's default five-minute deadline terminates the event stream used by long-running sessions.
    fetch: ((request: RequestInfo | URL, init?: RequestInit) =>
      fetch(request, { ...init, timeout: false } as BunFetchRequestInit)) as typeof fetch,
  })
  const explicit = parseRunModel(input.model)
  const target = await resolveSessionTarget({
    client,
    location: prepared.directory ? { directory: prepared.directory } : undefined,
    continue: input.continue,
    session: input.session,
    fork: input.fork,
    model: explicit
      ? { providerID: explicit.model.providerID, id: explicit.model.modelID, variant: explicit.variant }
      : undefined,
    agent: input.agent,
    environment: input.server.service ? Env.session() : undefined,
    prepare: async (next) => ({ model: await selectRunModel(client, next, options.variant), agent: next.agent }),
  }).catch((error) => {
    if (!(error instanceof RunTargetError)) throw error
    reportRunError(input, error.message, error.sessionID)
    return undefined
  })
  if (!target) return
  const model = target.model ? { providerID: target.model.providerID, modelID: target.model.id } : undefined
  const variant = target.model?.variant
  if (!target.resume && input.title !== undefined) {
    await client.session.update({
      sessionID: target.session.id,
      title: input.title || prepared.message.slice(0, 50) + (prepared.message.length > 50 ? "..." : ""),
    })
  }

  const budget = budgetLimits(input)
  if (Object.keys(budget).length > 0) await client.session.budget.update({ sessionID: target.session.id, ...budget })

  await runNonInteractivePrompt({
    client,
    sessionID: target.session.id,
    location: target.location,
    message: prepared.message,
    files: prepared.files,
    agent: target.agent,
    model,
    variant,
    thinking: input.thinking ?? false,
    format: input.format,
    auto: input.auto ?? false,
    attached: options.attached ?? true,
    compatibility: options.compatibility,
    renderTool: (part) => renderTool(part, target.location.directory),
    renderToolError: (part) => renderToolError(part, target.location.directory),
  }).catch((error) => reportRunError(input, errorMessage(error), target.session.id))
}

/**
 * The model a run pins before its Session exists: the requested or resumed one, or the location's
 * default when a variant needs a model to apply to. Otherwise the Session's agent chooses at run time.
 * A location without a default has no provider serving any model, so the run stops before creating a
 * Session and says how to connect one instead of failing on the first request.
 */
export async function selectRunModel(
  client: {
    readonly model: {
      readonly default: (input: { location: { directory: string } }) => Promise<{ readonly data: ModelRef | null }>
    }
  },
  next: {
    readonly location: { readonly directory: string }
    readonly model: ModelRef | undefined
    readonly session?: { readonly id: string } | undefined
  },
  variant: string | undefined,
): Promise<ModelRef | undefined> {
  const fallback = next.model
    ? undefined
    : await client.model.default({ location: { directory: next.location.directory } }).then((result) => result.data)
  if (!next.model && !fallback) throw new RunTargetError(NO_PROVIDER_MESSAGE, next.session?.id)
  const selected = next.model ?? (variant ? fallback : undefined)
  if (!selected) return undefined
  return { providerID: selected.providerID, id: selected.id, variant: variant ?? selected.variant }
}

export function mergeInput(message: string | undefined, piped: string | undefined) {
  if (!message) return piped || undefined
  if (!piped) return message
  return message + "\n" + piped
}

function formatMessage(message: string[]) {
  const value = message.map((part) => (part.includes(" ") ? `"${part.replace(/"/g, '\\"')}"` : part)).join(" ")
  return value || undefined
}

function localDirectory(root: string) {
  try {
    process.chdir(root)
    return process.cwd()
  } catch {
    fail(`Failed to change directory to ${root}`)
  }
}

/** The session limits `--max-cost` and `--max-tokens` set; a value that is not a limit fails the run. */
export function budgetLimits(input: Pick<RunCommandInput, "maxCost" | "maxTokens">) {
  const cost = input.maxCost === undefined ? undefined : SessionBudget.parseCost(input.maxCost)
  if (cost && !cost.ok) fail(`--max-cost: ${cost.error}`)
  const tokens = input.maxTokens === undefined ? undefined : SessionBudget.parseTokens(input.maxTokens)
  if (tokens && !tokens.ok) fail(`--max-tokens: ${tokens.error}`)
  return {
    ...(cost?.ok ? { maxCostUsd: cost.value } : {}),
    ...(tokens?.ok ? { maxTokens: tokens.value } : {}),
  }
}

export function parseRunModel(value?: string) {
  const ref = parseSessionTargetModel(value)
  if (!ref) return
  return {
    model: { providerID: ref.providerID, modelID: ref.id },
    variant: ref.variant,
  }
}

async function prepareFile(input: string, directory: string, options: ExecutionOptions): Promise<FilePart> {
  const file = path.resolve(directory, input)
  const handle = await open(file, "r").catch(() => fail(`File not found: ${input}`))
  try {
    const stat = await handle.stat()
    if (options.compatibility === "v1" && options.attached && stat.isDirectory())
      fail(`Cannot attach local directory without a shared filesystem: ${input}`)
    if (!stat.isFile() || stat.size > ATTACH_FILE_MAX_BYTES)
      fail(`Cannot attach a directory, special file, or file larger than 10 MiB: ${input}`)
    const content = Buffer.alloc(Number(stat.size))
    let offset = 0
    while (offset < content.length) {
      const read = await handle.read(content, offset, content.length - offset, offset)
      if (read.bytesRead === 0) break
      offset += read.bytesRead
    }
    const bytes = content.subarray(0, offset)
    const detected = FSUtil.mimeType(file)
    const text = bytes.toString("utf8")
    const mime =
      detected.startsWith("image/") || detected === "application/pdf"
        ? detected
        : !isBinaryContent(bytes) && Buffer.from(text, "utf8").equals(bytes)
          ? "text/plain"
          : detected
    return {
      url: `data:${mime};base64,${bytes.toString("base64")}`,
      filename: path.basename(file),
      mime,
    }
  } finally {
    await handle.close()
  }
}

function isBinaryContent(bytes: Uint8Array) {
  if (bytes.length === 0) return false
  if (bytes.includes(0)) return true
  return bytes.reduce((count, byte) => count + Number(byte < 9 || (byte > 13 && byte < 32)), 0) / bytes.length > 0.3
}

async function renderTool(part: SessionMessageAssistantTool, directory: string) {
  const info = toolInlineInfo(part, directory)
  if (info.mode === "block") {
    UI.empty()
    UI.println(UI.Style.TEXT_NORMAL + info.icon, UI.Style.TEXT_NORMAL + info.title)
    if (info.body?.trim()) UI.println(info.body)
    UI.empty()
    return
  }
  UI.println(
    UI.Style.TEXT_NORMAL + info.icon,
    UI.Style.TEXT_NORMAL + info.title,
    info.description ? UI.Style.TEXT_DIM + info.description + UI.Style.TEXT_NORMAL : "",
  )
}

async function renderToolError(part: SessionMessageAssistantTool, directory: string) {
  const info = toolInlineInfo(part, directory)
  UI.println(UI.Style.TEXT_NORMAL + "✗", UI.Style.TEXT_NORMAL + `${info.title} failed`)
}

/** @internal Used by the V1 command boundary before a Session exists. */
export function reportRunError(input: Pick<RunCommandInput, "format">, message: string, sessionID?: string) {
  process.exitCode = 1
  if (input.format === "json") {
    process.stdout.write(
      JSON.stringify({
        type: "error",
        timestamp: Date.now(),
        sessionID: sessionID ?? "",
        error: { type: "unknown", message },
      }) + "\n",
    )
    return
  }
  UI.error(message)
}

function fail(message: string): never {
  throw new Error(message)
}
