import { Agent } from "@/agent/agent"
import { Verbose } from "@reddb-io/redcode-core/observability/verbose"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { EventV2 } from "@reddb-io/redcode-core/event"
import { SessionEvent } from "@reddb-io/redcode-core/session/event"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { MCP } from "@/mcp"
import { McpCatalog } from "@/mcp/catalog"
import { Permission } from "@/permission"
import { Tool } from "@/tool/tool"
import { ToolJsonSchema } from "@/tool/json-schema"
import { ToolRegistry } from "@/tool/registry"
import { ToolOutputBridge } from "@/tool/output-bridge"

import { Plugin } from "@/plugin"
import type { TaskPromptOps } from "@/tool/task"
import { type Tool as AITool, tool, jsonSchema, type ToolExecutionOptions, asSchema } from "ai"
import { Cause, DateTime, Effect, Exit } from "effect"
import { MessageV2 } from "./message-v2"
import { Session } from "./session"
import { SessionProcessor } from "./processor"
import { PartID } from "./schema"
import { EffectBridge } from "@/effect/bridge"
import { ProviderV2 } from "@reddb-io/redcode-core/provider"
import { ModelV2 } from "@reddb-io/redcode-core/model"
import { isRecord } from "@/util/record"
import { OperationHook } from "@reddb-io/redcode-core/operation-hook"
import { JsonSchemaValidate } from "@reddb-io/redcode-core/util/json-schema-validate"
import { McpAttachments } from "@/mcp/attachments"
import { CodeModeGate } from "@/tool/code-mode-gate"
import { ToolDeadline } from "./tool-deadline"
import { HumanWait } from "./human-wait"
import type { SessionGuardLog } from "./guard-log"
import { OperationHookBridge } from "@/operation-hook-bridge"
import { SessionMessage } from "@reddb-io/redcode-schema/session-message"
import { ToolSearch } from "./tool-search"
import { NativeToolSearch } from "./native-tool-search"
import { RuntimeFlags } from "@/effect/runtime-flags"

const MCP_RESOURCE_TOOLS = {
  list: "list_mcp_resources",
  listTemplates: "list_mcp_resource_templates",
  read: "read_mcp_resource",
} as const

export const resolve = Effect.fn("SessionTools.resolve")(function* (input: {
  agent: Agent.Info
  model: Provider.Model
  session: Session.Info
  processor: Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall" | "guardLoop">
  bypassAgentCheck: boolean
  messages: SessionV1.WithParts[]
  promptOps: TaskPromptOps
  publishEvent: EventV2.Interface["publish"]
  structuredOutputTool?: AITool
  toolTimeout?: number | false
  toolSearch?: ToolSearch.Config
  /** The prompt's per-tool switches (`user.tools`); a tool switched off is never deferred or indexed. */
  userTools?: Record<string, boolean>
  /** `experimental.mcp_validation`; direct MCP calls warn when unset. */
  mcpValidation?: "strict" | "warn" | "off"
  /**
   * Whether this step has a Design context (the design agent, or a Session with Design
   * documents). Without one the `design_*` tools are deferred; omitted, they never are.
   */
  designContext?: boolean
  /** Passed in rather than resolved here: this module is used from callers that own the service. */
  recordGuard: (trip: SessionGuardLog.Trip) => Effect.Effect<void>
}) {
  const tools: Record<string, AITool> = {}
  const run = yield* EffectBridge.make()
  const plugin = yield* Plugin.Service
  const permission = yield* Permission.Service
  const registry = yield* ToolRegistry.Service
  const mcp = yield* MCP.Service
  const outputs = yield* ToolOutputBridge.Service
  const hooks = yield* OperationHookBridge.Service
  const flags = yield* RuntimeFlags.Service

  // One global override rather than a knob per tool: the failure this guards against is a tool
  // that never returns, and that is not a per-tool judgement.
  const toolTimeout = input.toolTimeout

  /**
   * The policy every tool call goes through, whether the model made it or a code mode script did:
   * `tool.execute.before`, PreExecute hooks (which may rewrite or refuse the arguments), the loop
   * guard, the tool deadline with permission waits deducted, and PostExecute. One wrapper, so a
   * script cannot reach a tool on terms a direct call would not get.
   */
  const guarded = <A>(call: {
    readonly toolID: string
    readonly callID: string
    readonly args: Record<string, unknown>
    readonly abort?: AbortSignal
    readonly run: (args: Record<string, unknown>, abort: AbortSignal | undefined) => Effect.Effect<A, unknown>
  }) =>
    Effect.gen(function* () {
      yield* plugin.trigger(
        "tool.execute.before",
        { tool: call.toolID, sessionID: input.session.id, callID: call.callID },
        { args: call.args },
      )
      const decided = yield* hooks.waterfall(OperationHook.Operation.Tool.PreExecute, {
        timestamp: yield* DateTime.now,
        sessionID: input.session.id,
        assistantMessageID: SessionMessage.ID.make(input.processor.message.id),
        callID: call.callID,
        tool: call.toolID,
        args: call.args,
      })
      const publishPost = (output: unknown, failed: boolean) =>
        Effect.gen(function* () {
          const payload = {
            timestamp: yield* DateTime.now,
            tool: call.toolID,
            sessionID: input.session.id,
            assistantMessageID: SessionMessage.ID.make(input.processor.message.id),
            callID: call.callID,
            args: decided.args,
            output,
            failed,
          }
          yield* hooks.parallel(OperationHook.Operation.Tool.PostExecute, payload)
          yield* input.publishEvent(SessionEvent.Tool.PostExecute, payload).pipe(Effect.ignore)
        })
      // Most tools carry no bound of their own, so one that never returns holds the whole
      // turn with no output and no error — and the turn's watchdog cannot help, because a
      // tool in flight is deliberately counted as work. A timeout here lands in the same
      // failure branch as any other tool error, so the model reads it and can react. The
      // signal the tool sees as `ctx.abort` is the guard's, so expiry also stops the tool
      // itself rather than only the report of it.
      const deadline = ToolDeadline.deadlineMs({ tool: call.toolID, configured: toolTimeout })
      // Asked before the call is made: a call whose answer is already known cannot become
      // useful by being made again, and the correction reaches the model as this tool's
      // own result, so it can change course without anyone being asked a question.
      const loop = yield* input.processor.guardLoop({ tool: call.toolID, input: decided.args })
      if (loop.type !== "ok") {
        yield* publishPost({ error: loop.message }, true).pipe(Effect.ignoreCause)
        return yield* Effect.fail(new Error(loop.message))
      }
      HumanWait.claim(input.session.id, call.callID)
      const startedAt = Date.now()
      yield* Verbose.log("tool.start", () => ({
        sessionID: input.session.id,
        tool: call.toolID,
        callID: call.callID,
        deadlineMs: deadline,
      }))
      const executed = yield* (
        deadline === undefined
          ? call.run(decided.args, call.abort)
          : ToolDeadline.guard((abort) => call.run(decided.args, abort), {
              tool: call.toolID,
              ms: deadline,
              abort: call.abort,
              waitedMs: () => HumanWait.waited(input.session.id, call.callID),
              onExpire: input.recordGuard({
                sessionID: input.session.id,
                guard: "tool_timeout",
                action: "stop",
                subject: call.toolID,
                detail: ToolDeadline.message({ tool: call.toolID, ms: deadline }),
              }),
            })
      ).pipe(Effect.exit)
      HumanWait.forget(input.session.id, call.callID)
      yield* Verbose.log("tool.end", () => ({
        sessionID: input.session.id,
        tool: call.toolID,
        callID: call.callID,
        ms: Date.now() - startedAt,
        waitedMs: HumanWait.waited(input.session.id, call.callID),
        ok: Exit.isSuccess(executed),
        bytes: Exit.isSuccess(executed) ? Verbose.size(executed.value) : 0,
      }))
      if (Exit.isFailure(executed)) {
        yield* publishPost({ error: String(Cause.squash(executed.cause)) }, true).pipe(Effect.ignoreCause)
        return yield* Effect.failCause(executed.cause)
      }
      yield* publishPost(executed.value, false)
      return executed.value
    })

  const withOperationHooks = (toolID: string, item: AITool): AITool => {
    const execute = item.execute
    if (!execute) return item
    return {
      ...item,
      execute(args, options) {
        return run.promise(
          guarded({
            toolID,
            callID: options.toolCallId ?? "",
            args: toRecord(args),
            abort: options.abortSignal,
            run: (decided, abort) =>
              Effect.promise(() =>
                Promise.resolve(execute(decided, abort ? { ...options, abortSignal: abort } : options)),
              ),
          }),
        )
      },
    }
  }

  // Read-only native tools a script may call this step; filled once the registry has resolved them.
  let natives: Tool.NativeTool[] = []
  // `parent/1`, `parent/2`, ... per parent call, for calls a tool makes itself.
  const nestedCounts = new Map<string, number>()

  /**
   * A permission ask that belongs to the tool part `toolCallID` and pauses the deadline of every
   * call in `waiting`: a script's call and the script itself are both blocked on the person.
   */
  const askFor =
    (waiting: readonly string[], toolCallID: string): Tool.Context["ask"] =>
    (req) =>
      Effect.suspend(() => {
        const stops = waiting.map((callID) => HumanWait.start(input.session.id, callID))
        return permission
          .ask({
            ...req,
            sessionID: input.session.id,
            tool: { messageID: input.processor.message.id, callID: toolCallID },
            ruleset: Permission.merge(input.agent.permission, input.session.permission ?? []),
          })
          .pipe(
            Effect.ensuring(
              Effect.sync(() => {
                for (const stop of stops) stop()
              }),
            ),
            Effect.orDie,
          )
      })

  const nestedFor = (options: ToolExecutionOptions): Tool.Nested => ({
    get natives() {
      return natives
    },
    userTools: input.userTools,
    call: (request) =>
      Effect.suspend(() => {
        const parent = options.toolCallId ?? ""
        const count = (nestedCounts.get(parent) ?? 0) + 1
        nestedCounts.set(parent, count)
        const callID = `${parent}/${count}`
        return guarded({
          toolID: request.tool,
          callID,
          args: request.args,
          abort: options.abortSignal,
          run: (args, abort) =>
            request.run({
              args,
              ctx: {
                ...context(args, options),
                callID,
                abort: abort ?? options.abortSignal!,
                // The parent part shows its own progress; a nested call must not overwrite it.
                metadata: () => Effect.void,
                ask: askFor([parent, callID], options.toolCallId),
                nested: undefined,
              },
            }),
        })
      }),
  })

  const withAllOperationHooks = () =>
    Object.fromEntries(Object.entries(tools).map(([toolID, item]) => [toolID, withOperationHooks(toolID, item)]))

  const context = (args: Record<string, unknown>, options: ToolExecutionOptions): Tool.Context => ({
    sessionID: input.session.id,
    abort: options.abortSignal!,
    messageID: input.processor.message.id,
    callID: options.toolCallId,
    extra: { model: input.model, bypassAgentCheck: input.bypassAgentCheck, promptOps: input.promptOps },
    agent: input.agent.name,
    messages: input.messages,
    metadata: (val) =>
      input.processor.updateToolCall(options.toolCallId, (match) => {
        if (!["running", "pending"].includes(match.state.status)) return match
        return {
          ...match,
          state: {
            title: val.title,
            metadata: val.metadata,
            status: "running",
            input: args,
            time: match.state.status === "running" ? match.state.time : { start: Date.now() },
          },
        }
      }),
    evaluate: (key, pattern) =>
      Permission.evaluate(key, pattern, Permission.merge(input.agent.permission, input.session.permission ?? []))
        .action,
    // A tool blocked on a person is not a tool that hung, so the wait is deducted from its
    // deadline rather than counted against it.
    ask: askFor([options.toolCallId ?? ""], options.toolCallId),
    nested: nestedFor(options),
  })

  const designEntries: ToolSearch.Entry[] = []
  const mcpEntries: ToolSearch.Entry[] = []

  const registered = yield* registry.tools({
    modelID: ModelV2.ID.make(input.model.api.id),
    providerID: input.model.providerID,
    agent: input.agent,
    permission: input.session.permission,
    recent: scriptToolsUsed(input.messages),
    userTools: input.userTools,
  })
  {
    const ruleset = Permission.merge(input.agent.permission, input.session.permission ?? [])
    const candidates = registered.filter((item) => CodeModeGate.SCRIPT_NATIVE_TOOLS.has(item.id))
    const hidden = Permission.disabled(
      candidates.map((item) => item.id),
      ruleset,
    )
    natives = candidates.filter((item) => !hidden.has(item.id) && input.userTools?.[item.id] !== false)
  }
  for (const item of registered) {
    const schema = ProviderTransform.schema(input.model, ToolJsonSchema.fromTool(item))
    if (item.id.startsWith(ToolSearch.DESIGN_NAMESPACE + "_"))
      designEntries.push({
        name: item.id,
        namespace: ToolSearch.DESIGN_NAMESPACE,
        description: item.description,
        schema: schema as Record<string, unknown>,
      })
    tools[item.id] = tool({
      description: item.description,
      inputSchema: jsonSchema(schema),
      execute(args, options) {
        return run.promise(
          Effect.gen(function* () {
            const ctx = context(args, options)
            const result = yield* item.execute(args, ctx)
            const output = {
              ...result,
              attachments: result.attachments?.map((attachment) => ({
                ...attachment,
                id: PartID.ascending(),
                sessionID: ctx.sessionID,
                messageID: input.processor.message.id,
              })),
            }
            yield* plugin.trigger(
              "tool.execute.after",
              { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID, args },
              output,
            )
            if (options.abortSignal?.aborted) {
              yield* input.processor.completeToolCall(options.toolCallId, output)
            }
            return output
          }),
        )
      },
    })
  }

  const hasMcpResourceServer = Object.values(yield* mcp.clients()).some(
    (client) => !!client.getServerCapabilities()?.resources,
  )
  if (hasMcpResourceServer) {
    tools[MCP_RESOURCE_TOOLS.list] = tool({
      description:
        "Lists resources provided by connected MCP servers. Resources provide context such as files, database schemas, or application-specific information.",
      inputSchema: jsonSchema(
        ProviderTransform.schema(input.model, {
          type: "object",
          properties: {
            server: {
              type: "string",
              description: "Optional MCP server name. When omitted, lists resources from every connected server.",
            },
          },
          additionalProperties: false,
        }),
      ),
      execute(args, opts) {
        return run.promise(
          Effect.gen(function* () {
            const parsed = parseListMcpResourcesArgs(args)
            const ctx = context(toRecord(args), opts)
            const clients = yield* mcp.clients()
            const resourceServers = Object.entries(clients)
              .filter((entry) => !!entry[1].getServerCapabilities()?.resources)
              .map((entry) => entry[0])
              .sort((a, b) => a.localeCompare(b))
            if (parsed.server && !resourceServers.includes(parsed.server)) {
              throw new Error(
                resourceServers.length === 0
                  ? `MCP server "${parsed.server}" does not support resources`
                  : `MCP server "${parsed.server}" does not support resources. Available resource servers: ${resourceServers.join(", ")}`,
              )
            }
            const permissionPatterns = parsed.server
              ? [`mcp:${parsed.server}:*`]
              : resourceServers.map((server) => `mcp:${server}:*`)
            yield* ctx.ask({
              permission: "read",
              metadata: parsed.server ? { server: parsed.server } : {},
              patterns: permissionPatterns,
              always: permissionPatterns,
            })

            const resources = Object.values(yield* mcp.resources(parsed.server))
            const filtered = resources
              .filter((resource) => !parsed.server || resource.client === parsed.server)
              .toSorted((a, b) =>
                (a.client + "\u0000" + a.name + "\u0000" + a.uri).localeCompare(
                  b.client + "\u0000" + b.name + "\u0000" + b.uri,
                ),
              )
            const content = JSON.stringify({ resources: filtered.map(formatMcpResource) }, null, 2)
            const truncated = yield* outputs.bound(content, ctx)
            const output = {
              title: parsed.server ? `MCP resources: ${parsed.server}` : "MCP resources",
              metadata: {
                count: filtered.length,
                servers: resourceServers,
                ...(parsed.server ? { server: parsed.server } : {}),
                truncated: truncated.truncated,
                ...(truncated.truncated && truncated.outputPath ? { outputPath: truncated.outputPath } : {}),
              },
              output: truncated.content,
            }
            yield* plugin.trigger(
              "tool.execute.after",
              { tool: MCP_RESOURCE_TOOLS.list, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
              output,
            )
            if (opts.abortSignal?.aborted) {
              yield* input.processor.completeToolCall(opts.toolCallId, output)
            }
            return output
          }),
        )
      },
    })

    tools[MCP_RESOURCE_TOOLS.listTemplates] = tool({
      description:
        "Lists resource templates provided by connected MCP servers. Resource templates are parameterized resources that can be read after filling in their URI template.",
      inputSchema: jsonSchema(
        ProviderTransform.schema(input.model, {
          type: "object",
          properties: {
            server: {
              type: "string",
              description:
                "Optional MCP server name. When omitted, lists resource templates from every connected server.",
            },
          },
          additionalProperties: false,
        }),
      ),
      execute(args, opts) {
        return run.promise(
          Effect.gen(function* () {
            const parsed = parseListMcpResourcesArgs(args)
            const ctx = context(toRecord(args), opts)
            const clients = yield* mcp.clients()
            const resourceServers = Object.entries(clients)
              .filter((entry) => !!entry[1].getServerCapabilities()?.resources)
              .map((entry) => entry[0])
              .sort((a, b) => a.localeCompare(b))
            if (parsed.server && !resourceServers.includes(parsed.server)) {
              throw new Error(
                resourceServers.length === 0
                  ? `MCP server "${parsed.server}" does not support resources`
                  : `MCP server "${parsed.server}" does not support resources. Available resource servers: ${resourceServers.join(", ")}`,
              )
            }
            const permissionPatterns = parsed.server
              ? [`mcp:${parsed.server}:*`]
              : resourceServers.map((server) => `mcp:${server}:*`)
            yield* ctx.ask({
              permission: "read",
              metadata: parsed.server ? { server: parsed.server } : {},
              patterns: permissionPatterns,
              always: permissionPatterns,
            })

            const templates = Object.values(yield* mcp.resourceTemplates(parsed.server))
            const filtered = templates
              .filter((template) => !parsed.server || template.client === parsed.server)
              .toSorted((a, b) =>
                (a.client + "\u0000" + a.name + "\u0000" + a.uriTemplate).localeCompare(
                  b.client + "\u0000" + b.name + "\u0000" + b.uriTemplate,
                ),
              )
            const content = JSON.stringify({ resourceTemplates: filtered.map(formatMcpResourceTemplate) }, null, 2)
            const truncated = yield* outputs.bound(content, ctx)
            const output = {
              title: parsed.server ? `MCP resource templates: ${parsed.server}` : "MCP resource templates",
              metadata: {
                count: filtered.length,
                servers: resourceServers,
                ...(parsed.server ? { server: parsed.server } : {}),
                truncated: truncated.truncated,
                ...(truncated.truncated && truncated.outputPath ? { outputPath: truncated.outputPath } : {}),
              },
              output: truncated.content,
            }
            yield* plugin.trigger(
              "tool.execute.after",
              { tool: MCP_RESOURCE_TOOLS.listTemplates, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
              output,
            )
            if (opts.abortSignal?.aborted) {
              yield* input.processor.completeToolCall(opts.toolCallId, output)
            }
            return output
          }),
        )
      },
    })

    tools[MCP_RESOURCE_TOOLS.read] = tool({
      description:
        "Read a specific resource from an MCP server using the server name and resource URI. The URI is an MCP identifier and does not need to be a file URL.",
      inputSchema: jsonSchema(
        ProviderTransform.schema(input.model, {
          type: "object",
          properties: {
            server: {
              type: "string",
              description: "MCP server name exactly as returned by list_mcp_resources.",
            },
            uri: {
              type: "string",
              description: "Resource URI to read. Use the exact URI string returned by list_mcp_resources.",
            },
          },
          required: ["server", "uri"],
          additionalProperties: false,
        }),
      ),
      execute(args, opts) {
        return run.promise(
          Effect.gen(function* () {
            const parsed = parseReadMcpResourceArgs(args)
            const ctx = context(toRecord(args), opts)
            const clients = yield* mcp.clients()
            const client = clients[parsed.server]
            if (!client) {
              throw new Error(`MCP server "${parsed.server}" is not connected`)
            }
            if (!client.getServerCapabilities()?.resources) {
              throw new Error(`MCP server "${parsed.server}" does not support resources`)
            }
            yield* ctx.ask({
              permission: "read",
              metadata: { server: parsed.server, uri: parsed.uri },
              patterns: [`mcp:${parsed.server}:${parsed.uri}`],
              always: [`mcp:${parsed.server}:*`],
            })

            const content = yield* mcp.readResource(parsed.server, parsed.uri)
            if (!content) throw new Error(`Failed to read MCP resource: ${parsed.server}/${parsed.uri}`)

            const formatted = formatMcpResourceContent(parsed.server, parsed.uri, content)
            const truncated = yield* outputs.bound(formatted.text, ctx)
            const output = {
              title: `MCP resource: ${parsed.uri}`,
              metadata: {
                server: parsed.server,
                uri: parsed.uri,
                contents: formatted.contents,
                attachments: formatted.attachments.length,
                truncated: truncated.truncated,
                ...(truncated.truncated && truncated.outputPath ? { outputPath: truncated.outputPath } : {}),
              },
              output: truncated.content,
              attachments: formatted.attachments.map((attachment) => ({
                ...attachment,
                id: PartID.ascending(),
                sessionID: ctx.sessionID,
                messageID: input.processor.message.id,
              })),
            }
            yield* plugin.trigger(
              "tool.execute.after",
              { tool: MCP_RESOURCE_TOOLS.read, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
              output,
            )
            if (opts.abortSignal?.aborted) {
              yield* input.processor.completeToolCall(opts.toolCallId, output)
            }
            return output
          }),
        )
      },
    })
  }

  if (input.structuredOutputTool) tools.StructuredOutput = input.structuredOutputTool

  // Deferred tools stay in the map, so a call to one is parsed and runs through the same
  // permission, hook, loop-guard and truncation path as any other; they are only left out of
  // what is advertised. A call to one that was never loaded therefore just works (and loads it
  // through history), which forgives a small model that guesses a listed name.
  const finish = Effect.fnUntraced(function* () {
    const ruleset = Permission.merge(input.agent.permission, input.session.permission ?? [])
    // The same filters the request applies (permission rules and the prompt's own tool switches),
    // so the index never lists, and tool_search never loads, a tool the request will drop.
    const visible = (entries: ToolSearch.Entry[]) => {
      const disabled = Permission.disabled(
        entries.map((entry) => entry.name),
        ruleset,
      )
      return entries.filter((entry) => !disabled.has(entry.name) && input.userTools?.[entry.name] !== false)
    }
    const deferred =
      Permission.disabled([ToolSearch.TOOL_ID], ruleset).has(ToolSearch.TOOL_ID) ||
      input.userTools?.[ToolSearch.TOOL_ID] === false
        ? []
        : ToolSearch.plan({
            config: input.toolSearch,
            mcp: visible(mcpEntries),
            design: visible(designEntries),
            designContext: input.designContext ?? true,
            tripped: ToolSearch.trippedInHistory(input.messages),
          })
    if (deferred.length === 0) return withAllOperationHooks()

    // With provider-native search every deferred definition is sent flagged and the provider loads
    // matches itself, so a tool it loaded stays deferred even once called.
    const native = NativeToolSearch.detect({
      model: input.model,
      config: input.toolSearch,
      nativeLlm: flags.experimentalNativeLlm,
    })
    const activated = new Map(
      ToolSearch.loadedFromHistory(
        input.messages,
        new Set(deferred.map((entry) => entry.name)),
        native ? NativeToolSearch.referenced(input.messages) : undefined,
      ).map((name, rank) => [name, rank] as const),
    )
    const pending = new Set(deferred.filter((entry) => !activated.has(entry.name)).map((entry) => entry.name))
    // Present whenever anything is deferrable, even once all of it is loaded: removing the tool
    // later would rewrite the advertised prefix. Its description is static; the index rides the
    // system context.
    tools[ToolSearch.TOOL_ID] = ToolSearch.withIndex(
      ToolSearch.withNative(
        tool({
          description: ToolSearch.DESCRIPTION,
          inputSchema: jsonSchema(
            ProviderTransform.schema(input.model, structuredClone(ToolSearch.InputSchema) as never),
          ),
          execute(args, opts) {
            return run.promise(
              Effect.gen(function* () {
                const active = new Set(
                  Object.keys(tools).filter((name) => !pending.has(name) && input.userTools?.[name] !== false),
                )
                const output = ToolSearch.run(deferred, active, toRecord(args))
                yield* plugin.trigger(
                  "tool.execute.after",
                  { tool: ToolSearch.TOOL_ID, sessionID: input.session.id, callID: opts.toolCallId, args },
                  output,
                )
                if (opts.abortSignal?.aborted) yield* input.processor.completeToolCall(opts.toolCallId, output)
                return output
              }),
            )
          },
        }),
        native,
      ),
      ToolSearch.indexText(deferred, native !== undefined),
    )
    const wrapped = withAllOperationHooks()
    const namespaces = new Map(deferred.map((entry) => [entry.name, entry.namespace]))
    for (const name of pending)
      if (wrapped[name]) wrapped[name] = ToolSearch.markDeferred(wrapped[name], namespaces.get(name))
    for (const [name, rank] of activated)
      if (wrapped[name]) wrapped[name] = ToolSearch.markActivated(wrapped[name], rank)
    return wrapped
  })

  // Code mode replaces direct MCP tools only when this step really advertises `execute`: the
  // registry gates it per model, and a permission rule or the prompt's switches can still drop it.
  const codeMode =
    tools[CodeModeGate.TOOL_ID] !== undefined &&
    input.userTools?.[CodeModeGate.TOOL_ID] !== false &&
    !Permission.disabled(
      [CodeModeGate.TOOL_ID],
      Permission.merge(input.agent.permission, input.session.permission ?? []),
    ).has(CodeModeGate.TOOL_ID)
  if (codeMode) return yield* finish()

  const servers = Object.keys(yield* mcp.clients()).map(McpCatalog.sanitize)
  for (const [key, entry] of Object.entries(yield* mcp.tools())) {
    const item = McpCatalog.convertTool(entry.def, entry.client, entry.timeout)
    const execute = item.execute
    if (!execute) continue

    const schema = yield* Effect.promise(() => Promise.resolve(asSchema(item.inputSchema).jsonSchema))
    const transformed = ProviderTransform.schema(input.model, { ...schema, properties: schema.properties ?? {} })
    item.inputSchema = jsonSchema(transformed)
    mcpEntries.push({
      name: key,
      namespace: ToolSearch.namespaceOf(key, servers),
      description: entry.def.description ?? "",
      schema: transformed as Record<string, unknown>,
    })
    item.execute = (args, opts) =>
      run.promise(
        Effect.gen(function* () {
          const ctx = context(args, opts)
          // The provider only parses the arguments as JSON; the server's schema is the contract. Servers
          // publish slightly wrong schemas often enough that direct calls only warn unless told otherwise.
          const mode = input.mcpValidation ?? "warn"
          const invalid = mode === "off" ? [] : JsonSchemaValidate.problems(entry.def.inputSchema, args ?? {})
          if (invalid.length > 0 && mode === "strict")
            throw new Tool.InvalidArgumentsError({ tool: key, detail: JsonSchemaValidate.describe(invalid) })
          if (invalid.length > 0)
            yield* Effect.logWarning("MCP tool arguments do not match its input schema; calling it anyway", {
              tool: key,
              problems: JsonSchemaValidate.describe(invalid),
            })
          const result: Awaited<ReturnType<NonNullable<typeof execute>>> = yield* Effect.gen(function* () {
            yield* ctx.ask({ permission: key, metadata: {}, patterns: ["*"], always: ["*"] })
            return yield* Effect.promise(() => execute(args, opts))
          }).pipe(
            Effect.withSpan("Tool.execute", {
              attributes: {
                "tool.name": key,
                "tool.call_id": opts.toolCallId,
                "session.id": ctx.sessionID,
                "message.id": input.processor.message.id,
              },
            }),
          )
          yield* plugin.trigger(
            "tool.execute.after",
            { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
            result,
          )

          const textParts: string[] = []
          const attachments: Omit<SessionV1.FilePart, "id" | "sessionID" | "messageID">[] = []
          for (const contentItem of result.content) {
            if (contentItem.type === "text") textParts.push(contentItem.text)
            else if (contentItem.type === "image") {
              attachments.push({
                type: "file",
                mime: contentItem.mimeType,
                url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
              })
            } else if (contentItem.type === "resource") {
              const { resource } = contentItem
              if (resource.text) textParts.push(resource.text)
              if (resource.blob) {
                const mime = resource.mimeType ?? "application/octet-stream"
                const refused = McpAttachments.refusal({ label: resource.uri, mime, base64: resource.blob })
                if (refused) {
                  textParts.push(refused)
                  continue
                }
                attachments.push({
                  type: "file",
                  mime,
                  url: `data:${mime};base64,${resource.blob}`,
                  filename: resource.uri,
                })
              }
            }
          }

          const truncated = yield* outputs.bound(textParts.join("\n\n"), ctx)
          const metadata = {
            ...result.metadata,
            truncated: truncated.truncated,
            ...(truncated.truncated && truncated.outputPath ? { outputPath: truncated.outputPath } : {}),
          }

          const output = {
            title: "",
            metadata,
            output: truncated.content,
            attachments: attachments.map((attachment) => ({
              ...attachment,
              id: PartID.ascending(),
              sessionID: ctx.sessionID,
              messageID: input.processor.message.id,
            })),
            content: result.content,
          }
          if (opts.abortSignal?.aborted) {
            yield* input.processor.completeToolCall(opts.toolCallId, output)
          }
          return output
        }),
      )
    tools[key] = item
  }

  return yield* finish()
})

function toRecord(value: unknown) {
  if (isRecord(value)) return value
  return {}
}

function parseListMcpResourcesArgs(value: unknown) {
  const args = toRecord(value)
  return { server: optionalString(args, "server") }
}

function parseReadMcpResourceArgs(value: unknown) {
  const args = toRecord(value)
  return { server: requiredString(args, "server"), uri: requiredString(args, "uri") }
}

function optionalString(args: Record<string, unknown>, key: string) {
  const value = args[key]
  if (value === undefined || value === null || value === "") return undefined
  if (typeof value !== "string") throw new Error(`${key} must be a string`)
  return value
}

function requiredString(args: Record<string, unknown>, key: string) {
  const value = optionalString(args, key)
  if (value) return value
  throw new Error(`${key} is required`)
}

function formatMcpResource(resource: MCP.Resource) {
  const result = Object.fromEntries(Object.entries(resource).filter((entry) => entry[0] !== "client"))
  return { ...result, server: resource.client }
}

function formatMcpResourceTemplate(template: Record<string, unknown> & { client: string }) {
  const result = Object.fromEntries(Object.entries(template).filter((entry) => entry[0] !== "client"))
  return { ...result, server: template.client }
}

function formatMcpResourceContent(server: string, uri: string, content: { contents: unknown }) {
  const items = (Array.isArray(content.contents) ? content.contents : [content.contents]).filter(isRecord)
  const text: string[] = []
  const attachments: Omit<SessionV1.FilePart, "id" | "sessionID" | "messageID">[] = []

  for (const item of items) {
    const itemUri = typeof item.uri === "string" ? item.uri : uri
    const mime = typeof item.mimeType === "string" ? item.mimeType : "application/octet-stream"
    if (typeof item.text === "string") {
      text.push(`Resource: ${itemUri}\nMIME: ${mime}\n${item.text}`)
      continue
    }
    if (typeof item.blob === "string") {
      const refused = McpAttachments.refusal({ label: itemUri, mime, base64: item.blob })
      if (refused) {
        text.push(refused)
        continue
      }
      text.push(`[Binary MCP resource attached: ${itemUri} (${mime})]`)
      attachments.push({
        type: "file",
        mime,
        url: `data:${mime};base64,${item.blob}`,
        filename: itemUri,
      })
      continue
    }
    text.push(`[MCP resource content without text or blob: ${itemUri}]`)
  }

  return {
    contents: items.length,
    attachments,
    text: text.join("\n\n") || `MCP resource ${uri} from ${server} returned no contents.`,
  }
}

/**
 * Script tool paths (`github.issue_read`, `redcode.read`) this session's `execute` calls already
 * made, for ranking the code mode catalog. A set, not counts: the catalog text only changes when a
 * new tool is first used, and not at all while every signature fits.
 */
export function scriptToolsUsed(messages: readonly SessionV1.WithParts[]) {
  const used = new Set<string>()
  for (const message of messages)
    for (const part of message.parts) {
      if (part.type !== "tool" || part.tool !== CodeModeGate.TOOL_ID || !("metadata" in part.state)) continue
      const calls = part.state.metadata?.toolCalls
      if (!Array.isArray(calls)) continue
      for (const call of calls)
        if (isRecord(call) && typeof call.tool === "string" && !call.tool.startsWith("$codemode.")) used.add(call.tool)
    }
  return [...used].sort()
}

export * as SessionTools from "./tools"
