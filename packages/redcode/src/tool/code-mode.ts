import * as Tool from "./tool"
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { Cause, Duration, Effect, Schema, Semaphore } from "effect"
import { CodeMode, Tool as SandboxTool, toolError } from "@reddb-io/redcode-codemode"
import { PermissionV1 } from "@reddb-io/redcode-core/v1/permission"
import { JsonSchemaValidate } from "@reddb-io/redcode-core/util/json-schema-validate"
import { MCP } from "@/mcp"
import { McpCatalog } from "@/mcp/catalog"
import { McpAttachments } from "@/mcp/attachments"
import { Agent } from "@/agent/agent"
import { Session } from "@/session/session"
import { HumanWait } from "@/session/human-wait"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import { ToolOutputBridge } from "./output-bridge"
import { ToolJsonSchema } from "./json-schema"
import { CodeModeGate } from "./code-mode-gate"

export const CODE_MODE_TOOL = CodeModeGate.TOOL_ID

/** Namespace of the read-only native tools inside a script. */
export const NATIVE_NAMESPACE = "redcode"

const DESCRIPTION = "Run a confined orchestration script with access to connected MCP tools."

export const Parameters = Schema.Struct({
  code: Schema.String.annotate({
    description: "Script body executed by the confined interpreter.",
  }),
})

type CallEntry = {
  tool: string
  status: "running" | "completed" | "error"
  input?: Record<string, unknown>
  title?: string
}

type Metadata = {
  toolCalls: CallEntry[]
  error?: boolean
  rejected?: boolean
  truncated?: boolean
  outputPath?: string
}

type Attachment = NonNullable<Tool.ExecuteResult["attachments"]>[number]

type CatalogEntry = {
  path: string
  key: string
  server: string
  local: string
  tool: MCP.McpTool
}

const ARGS_PREVIEW_CHARS = 300
const RESULT_PREVIEW_CHARS = 2000

function groupByServer(mcpTools: Record<string, MCP.McpTool>, servers: readonly string[]): Map<string, CatalogEntry[]> {
  const byLongest = [...servers].sort((a, b) => b.length - a.length)
  const groups = new Map<string, CatalogEntry[]>()
  for (const key of Object.keys(mcpTools).sort((a, b) => a.localeCompare(b))) {
    const server =
      byLongest.find((name) => key.startsWith(name + "_")) ?? (key.includes("_") ? key.slice(0, key.indexOf("_")) : key)
    const local = server && key.startsWith(server + "_") ? key.slice(server.length + 1) : key
    const entry: CatalogEntry = {
      path: `${server}.${local}`,
      key,
      server,
      local,
      tool: mcpTools[key]!,
    }
    groups.set(server, [...(groups.get(server) ?? []), entry])
  }
  return groups
}

export type CatalogOptions = {
  /** Read-only native tools exposed under `tools.redcode`. */
  readonly natives?: ReadonlyArray<Tool.NativeTool>
  /** Script tool paths this session already used; ranked earlier when the catalog is partial. */
  readonly recent?: ReadonlyArray<string>
}

export function describeCatalog(
  mcpTools: Record<string, MCP.McpTool>,
  servers: readonly string[],
  options: CatalogOptions = {},
): string {
  const preview = () => () => Effect.fail(toolError("Tool preview is not executable."))
  return CodeMode.make({
    tools: toolTree([...groupByServer(mcpTools, servers).values()].flat(), options.natives ?? [], preview, preview),
    discovery: { recent: options.recent ?? [] },
  }).instructions()
}

const lastSegment = (uri: string) => {
  const trimmed = uri.split(/[?#]/, 1)[0]!.replace(/\/+$/, "")
  const segment = trimmed.slice(trimmed.lastIndexOf("/") + 1)
  return segment.length > 0 ? segment : undefined
}

const dataUrl = (mime: string, base64: string) => `data:${mime};base64,${base64}`

/**
 * The value a script sees for an MCP result. Binary blocks leave through the attachment channel,
 * under the same MIME allowlist and size cap as a direct MCP call; refused ones become text.
 */
export function projectMcpResult(result: CallToolResult, collect: (attachment: Attachment) => void): unknown {
  const text: string[] = []
  let files = 0
  let images = 0
  const push = (attachment: Attachment, label: string, base64: string) => {
    const refused = McpAttachments.refusal({ label, mime: attachment.mime, base64 })
    if (refused) {
      text.push(refused)
      return
    }
    files += 1
    if (attachment.mime.startsWith("image/")) images += 1
    collect(attachment)
  }
  for (const block of result.content) {
    switch (block.type) {
      case "text":
        text.push(block.text)
        break
      case "image":
      case "audio":
        push(
          { type: "file", mime: block.mimeType, url: dataUrl(block.mimeType, block.data) },
          `${block.type} content`,
          block.data,
        )
        break
      case "resource": {
        if ("text" in block.resource) {
          text.push(block.resource.text)
          break
        }
        const mime = block.resource.mimeType ?? "application/octet-stream"
        push(
          { type: "file", mime, url: dataUrl(mime, block.resource.blob), filename: lastSegment(block.resource.uri) },
          block.resource.uri,
          block.resource.blob,
        )
        break
      }
      case "resource_link":
        // A link is a reference, not fetchable media; hand it to the program instead of the attachment channel.
        text.push(`${block.name}: ${block.uri}`)
        break
    }
  }

  if (result.structuredContent !== undefined && result.structuredContent !== null) return result.structuredContent
  if (text.length > 0) return text.join("\n")
  if (files > 0) {
    const noun = files === images ? "image" : "file"
    return `[${files} ${noun}${files === 1 ? "" : "s"} attached to the result]`
  }
  return null
}

type Run = (input: unknown) => Effect.Effect<unknown, unknown>

function toolTree(
  catalog: readonly CatalogEntry[],
  natives: ReadonlyArray<Tool.NativeTool>,
  run: (entry: CatalogEntry) => Run,
  runNative: (tool: Tool.NativeTool) => Run,
) {
  const tree: Record<string, Record<string, SandboxTool.Definition>> = {}
  for (const entry of catalog) {
    const namespace = (tree[entry.server] ??= {})
    namespace[entry.local] = SandboxTool.make({
      description: entry.tool.def.description ?? "",
      input: entry.tool.def.inputSchema as SandboxTool.JsonSchema,
      output: entry.tool.def.outputSchema as SandboxTool.JsonSchema | undefined,
      run: run(entry),
    })
  }
  for (const native of natives) {
    const namespace = (tree[NATIVE_NAMESPACE] ??= {})
    namespace[native.id] = SandboxTool.make({
      description: native.description,
      input: nativeSchema(native) as SandboxTool.JsonSchema,
      run: runNative(native),
    })
  }
  return tree
}

const nativeSchema = (native: Tool.NativeTool) =>
  ToolJsonSchema.fromTool({ ...native, execute: native.execute } as Tool.Def) as Record<string, unknown>

const preview = (value: unknown, max: number) => {
  let text: string
  try {
    text = JSON.stringify(value) ?? String(value)
  } catch {
    text = String(value)
  }
  return text.length > max ? text.slice(0, max - 1) + "…" : text
}

const isRejection = (error: unknown): error is PermissionV1.RejectedError | PermissionV1.CorrectedError =>
  error instanceof PermissionV1.RejectedError || error instanceof PermissionV1.CorrectedError

/** The legacy transport call, kept identical to McpCatalog.convertTool so the MCP service stays loop-free. */
const callMcp = (entry: CatalogEntry, args: Record<string, unknown>, abort: AbortSignal) =>
  Effect.promise(async () => {
    const raw = await entry.tool.client.callTool({ name: entry.tool.def.name, arguments: args }, CallToolResultSchema, {
      resetTimeoutOnProgress: true,
      signal: abort,
      timeout: entry.tool.timeout,
      // The MCP SDK only sends a progress token when this hook is present, enabling timeout resets.
      onprogress: () => {},
    })
    if (raw.isError)
      throw new Error(
        raw.content
          .flatMap((item) => (item.type === "text" ? [item.text] : []))
          .filter((text) => text.trim())
          .join("\n\n") || "MCP tool returned an error",
      )
    return raw as CallToolResult
  })

export const CodeModeTool = Tool.define(
  CODE_MODE_TOOL,
  Effect.gen(function* () {
    const mcp = yield* MCP.Service
    const agents = yield* Agent.Service
    const sessions = yield* Session.Service
    const plugin = yield* Plugin.Service
    const config = yield* Config.Service
    const outputs = yield* ToolOutputBridge.Service

    const init: Tool.DefWithoutID<typeof Parameters, Metadata> = {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: Effect.fn("CodeMode.execute")(function* (params, ctx) {
        if (ctx.abort.aborted) {
          return {
            title: CODE_MODE_TOOL,
            metadata: { toolCalls: [], error: true },
            output: "Execution cancelled.",
          } satisfies Tool.ExecuteResult<Metadata>
        }
        const agent = yield* agents.get(ctx.agent)
        const session = yield* sessions.get(ctx.sessionID).pipe(Effect.orDie)
        const ruleset = Permission.merge(agent.permission, session.permission ?? [])
        const mcpTools = Permission.visibleTools(yield* mcp.tools(), ruleset)
        const servers = Object.keys(yield* mcp.clients()).map(McpCatalog.sanitize)
        const catalog = [...groupByServer(mcpTools, servers).values()].flat()
        const natives = ctx.nested?.natives ?? []
        const limits = CodeModeGate.limits((yield* config.get()).experimental?.code_mode)

        const calls: CallEntry[] = []
        const attachments: Attachment[] = []
        const completed: Array<{ path: string; value: unknown }> = []
        const rejections: Array<{ path: string; message: string }> = []
        const publish = () =>
          ctx.metadata({ title: CODE_MODE_TOOL, metadata: { toolCalls: calls.map((c) => ({ ...c })) } })

        // Asks for the same tool are queued, so a script fanning out with Promise.all shows one
        // prompt at a time. "Always" on the first then settles the rest without a prompt (the
        // permission service re-evaluates approved rules), "once" moves on to the next, and a
        // rejection rejects every pending ask of the session. Batching would need a new permission
        // request shape every client renders; a queue keeps the existing one.
        const askQueues = new Map<string, Semaphore.Semaphore>()
        const queuedAsk =
          (base: Tool.Context["ask"], waiting: readonly string[], script: { tool: string; args: unknown }) =>
          (req: Parameters<Tool.Context["ask"]>[0]) =>
            Effect.suspend(() => {
              const queue = askQueues.get(req.permission) ?? Semaphore.makeUnsafe(1)
              askQueues.set(req.permission, queue)
              // Waiting behind another prompt is waiting on the person too.
              const stops = waiting.map((callID) => HumanWait.start(ctx.sessionID, callID))
              return queue
                .withPermit(
                  base({
                    ...req,
                    metadata: {
                      ...req.metadata,
                      script: { tool: script.tool, args: preview(script.args, ARGS_PREVIEW_CHARS) },
                    },
                  }),
                )
                .pipe(
                  Effect.ensuring(
                    Effect.sync(() => {
                      for (const stop of stops) stop()
                    }),
                  ),
                )
            })

        let fallbackCalls = 0
        /** Runs one call through the session's per-call policy, or plain hooks where there is none (tests). */
        const policy = <A>(request: Tool.NestedCall<A>) => {
          if (ctx.nested) return ctx.nested.call(request)
          fallbackCalls += 1
          const callID = `${ctx.callID ?? request.tool}/${fallbackCalls}`
          return Effect.gen(function* () {
            yield* plugin.trigger(
              "tool.execute.before",
              { tool: request.tool, sessionID: ctx.sessionID, callID },
              { args: request.args },
            )
            return yield* request.run({ args: request.args, ctx: { ...ctx, callID, metadata: () => Effect.void } })
          })
        }

        const settle = (path: string) => (effect: Effect.Effect<unknown, unknown>) =>
          effect.pipe(
            Effect.tap((value) => Effect.sync(() => completed.push({ path, value }))),
            Effect.catchCause((cause) => {
              if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt
              const error = Cause.squash(cause)
              const message = error instanceof Error ? error.message : String(error)
              if (isRejection(error)) rejections.push({ path, message })
              return Effect.fail(toolError(message, error))
            }),
          )

        const invalidInput = (path: string, schema: unknown, input: unknown) => {
          const problems = JsonSchemaValidate.problems(schema, input)
          if (problems.length === 0) return undefined
          return toolError(`Invalid input for tools.${path}: ${JsonSchemaValidate.describe(problems)}`)
        }

        const callTool = (entry: CatalogEntry) => (input: unknown) => {
          const args = (input ?? {}) as Record<string, unknown>
          const invalid = invalidInput(entry.path, entry.tool.def.inputSchema, args)
          if (invalid) return Effect.fail(invalid)
          return policy({
            tool: entry.key,
            args,
            run: ({ args, ctx: child }) =>
              Effect.gen(function* () {
                const ask = queuedAsk(child.ask, [ctx.callID ?? "", child.callID ?? ""], { tool: entry.path, args })
                yield* ask({ permission: entry.key, metadata: {}, patterns: ["*"], always: ["*"] })
                const result = yield* callMcp(entry, args, child.abort).pipe(
                  Effect.withSpan("Tool.execute", {
                    attributes: {
                      "tool.name": entry.key,
                      "tool.call_id": child.callID ?? "",
                      "session.id": ctx.sessionID,
                      "message.id": ctx.messageID,
                    },
                  }),
                )
                yield* plugin.trigger(
                  "tool.execute.after",
                  { tool: entry.key, sessionID: ctx.sessionID, callID: child.callID, args },
                  result,
                )
                return projectMcpResult(result, (attachment) => void attachments.push(attachment))
              }),
          }).pipe(settle(entry.path))
        }

        const callNative = (native: Tool.NativeTool) => (input: unknown) => {
          const path = `${NATIVE_NAMESPACE}.${native.id}`
          const args = (input ?? {}) as Record<string, unknown>
          const invalid = invalidInput(path, nativeSchema(native), args)
          if (invalid) return Effect.fail(invalid)
          return policy({
            tool: native.id,
            args,
            run: ({ args, ctx: child }) =>
              Effect.gen(function* () {
                const result = yield* native.execute(args, {
                  ...child,
                  ask: queuedAsk(child.ask, [ctx.callID ?? "", child.callID ?? ""], { tool: path, args }),
                })
                yield* plugin.trigger(
                  "tool.execute.after",
                  { tool: native.id, sessionID: ctx.sessionID, callID: child.callID, args },
                  result,
                )
                for (const attachment of result.attachments ?? []) {
                  const base64 = attachment.url.startsWith("data:")
                    ? attachment.url.slice(attachment.url.indexOf(",") + 1)
                    : ""
                  if (!McpAttachments.refusal({ label: path, mime: attachment.mime, base64 }))
                    attachments.push(attachment)
                }
                const index = calls.findLastIndex((call) => call.tool === path && call.status === "running")
                if (index >= 0 && result.title) calls[index] = { ...calls[index]!, title: result.title }
                return result.output
              }),
          }).pipe(settle(path))
        }

        const runtime = CodeMode.make({
          tools: toolTree(catalog, natives, callTool, callNative),
          limits: { maxToolCalls: limits.maxToolCalls, maxOutputBytes: limits.maxOutputBytes },
          onToolCallStart: ({ index, name, input }) =>
            Effect.suspend(() => {
              const shown = (() => {
                if (input === null || input === undefined) return
                if (typeof input === "object" && !Array.isArray(input)) {
                  const value = input as Record<string, unknown>
                  return Object.keys(value).length > 0 ? value : undefined
                }
                return { input }
              })()
              calls[index] = { tool: name, status: "running", ...(shown ? { input: shown } : {}) }
              return publish()
            }),
          onToolCallEnd: ({ index, outcome }) =>
            Effect.suspend(() => {
              const current = calls[index]
              if (current) calls[index] = { ...current, status: outcome === "success" ? "completed" : "error" }
              return publish()
            }),
        })

        const abort = Effect.callback<void>((resume) => {
          if (ctx.abort.aborted) return resume(Effect.void)
          const handler = () => resume(Effect.void)
          ctx.abort.addEventListener("abort", handler, { once: true })
          return Effect.sync(() => ctx.abort.removeEventListener("abort", handler))
        })
        const cancelled = (): CodeMode.Result => ({
          ok: false,
          error: { kind: "ExecutionFailure", message: "Execution cancelled." },
          toolCalls: calls.map((call) => ({ name: call.tool })),
        })
        // Wall time minus time spent on permission prompts, the same way the tool deadline counts.
        const timeout: Effect.Effect<CodeMode.Result> = Effect.gen(function* () {
          const started = Date.now()
          const waited = () => (ctx.callID ? HumanWait.waited(ctx.sessionID, ctx.callID) : 0)
          const step = Duration.millis(Math.max(1, Math.min(limits.timeoutMs, 100)))
          while (Date.now() - started - waited() < limits.timeoutMs) yield* Effect.sleep(step)
          return {
            ok: false,
            error: {
              kind: "TimeoutExceeded",
              message: `Execution timed out after ${limits.timeoutMs}ms; return partial results sooner or split the work across executions.`,
            },
            toolCalls: calls.map((call) => ({ name: call.tool })),
          } satisfies CodeMode.Result
        })

        const result: CodeMode.Result = yield* Effect.raceAll([
          runtime.execute(params.code),
          abort.pipe(Effect.map(cancelled)),
          timeout,
        ])
        const logs = result.logs ?? []
        const withLogs = (text: string) => {
          if (logs.length === 0) return text
          return text.length > 0 ? `${text}\n\nLogs:\n${logs.join("\n")}` : `Logs:\n${logs.join("\n")}`
        }
        const bounded = (text: string) =>
          outputs.bound(text, ctx).pipe(
            Effect.map((out) => ({
              output: out.content,
              truncated: out.truncated,
              ...(out.truncated && out.outputPath ? { outputPath: out.outputPath } : {}),
            })),
          )

        // A rejected call must not throw away what the script already learned: the completed
        // results and the rejection go back to the model as the result.
        const rejectionReport = (lead: string) =>
          [
            lead,
            ...rejections.map((item) => `Rejected: tools.${item.path}: ${item.message}`),
            ...(completed.length > 0
              ? [
                  "",
                  "Completed calls before the rejection:",
                  ...completed.map((item) => `- tools.${item.path}: ${preview(item.value, RESULT_PREVIEW_CHARS)}`),
                ]
              : ["No call completed before the rejection."]),
            "",
            "Do not retry the rejected call unless the user asks for it.",
          ].join("\n")

        if (!result.ok) {
          if (ctx.abort.aborted) {
            return {
              title: CODE_MODE_TOOL,
              metadata: { toolCalls: calls, error: true },
              output: "Execution cancelled.",
            } satisfies Tool.ExecuteResult<Metadata>
          }
          if (rejections.length > 0) {
            const out = yield* bounded(withLogs(rejectionReport(`The script stopped: ${result.error.message}`)))
            return {
              title: CODE_MODE_TOOL,
              metadata: {
                toolCalls: calls,
                rejected: true,
                truncated: out.truncated,
                ...(out.outputPath ? { outputPath: out.outputPath } : {}),
              },
              output: out.output,
              ...(attachments.length > 0 ? { attachments } : {}),
            } satisfies Tool.ExecuteResult<Metadata>
          }
          const error = result.error
          const hints = (error.suggestions ?? []).filter((hint: string) => !error.message.includes(hint))
          const out = yield* bounded(withLogs([result.error.message, ...hints].join("\n")))
          return yield* Effect.fail(new Error(out.output))
        }

        // The interpreter validates returned values as plain JSON, so stringify cannot throw;
        // it yields undefined only for a program that returns undefined.
        const value =
          typeof result.value === "string"
            ? result.value
            : (JSON.stringify(result.value, null, 2) ?? String(result.value))
        const text =
          rejections.length > 0 ? `${value}\n\n${rejectionReport("Some calls were rejected by the user.")}` : value
        const out = yield* bounded(withLogs(text))

        return {
          title: CODE_MODE_TOOL,
          metadata: {
            toolCalls: calls,
            truncated: out.truncated,
            ...(out.outputPath ? { outputPath: out.outputPath } : {}),
            ...(rejections.length > 0 ? { rejected: true } : {}),
          },
          output: out.output,
          ...(attachments.length > 0 ? { attachments } : {}),
        } satisfies Tool.ExecuteResult<Metadata>
      }, Effect.orDie),
    }
    return init
  }),
)
