import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { Verbose } from "@reddb-io/redcode-core/observability/verbose"
import { llmClient } from "@reddb-io/redcode-core/effect/app-node-platform"
import { PermissionV1 } from "@reddb-io/redcode-core/v1/permission"
import { Provider } from "@/provider/provider"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { serviceUse } from "@reddb-io/redcode-core/effect/service-use"
import { Cause, Context, Effect, Layer } from "effect"
import * as Stream from "effect/Stream"
import { NoSuchToolError, streamText, wrapLanguageModel, type ModelMessage, type Tool } from "ai"
import { unknownToolMessage } from "@/tool/invalid"
import type { LLMEvent } from "@reddb-io/redcode-llm"
import { LLMClient } from "@reddb-io/redcode-llm/route"
import type { LLMClientService } from "@reddb-io/redcode-llm/route"
import { GitLabWorkflowLanguageModel } from "gitlab-ai-provider"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"
import { Plugin } from "@/plugin"
import { Permission } from "@/permission"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@reddb-io/redcode-core/event"
import { Wildcard } from "@/util/wildcard"
import { SessionID } from "@/session/schema"
import { Auth } from "@/auth"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import * as Option from "effect/Option"
import * as OtelTracer from "@effect/opentelemetry/Tracer"
import { LLMAISDK } from "./llm/ai-sdk"
import { LLMNativeRuntime } from "./llm/native-runtime"
import { LLMRequestPrep } from "./llm/request"
import { OperationHookBridge } from "@/operation-hook-bridge"
import { ToolSearch } from "./tool-search"
import { SessionSpend } from "./spend"
import { NativeToolSearch } from "./native-tool-search"

export const OUTPUT_TOKEN_MAX = ProviderTransform.OUTPUT_TOKEN_MAX

export type StreamInput = {
  user: SessionV1.User
  sessionID: string
  parentSessionID?: string
  model: Provider.Model
  agent: Agent.Info
  permission?: PermissionV1.Ruleset
  system: string[]
  messages: ModelMessage[]
  small?: boolean
  tools: Record<string, Tool>
  retries?: number
  toolChoice?: "auto" | "required" | "none"
  /** Caps the response below the model's own output limit, e.g. for a compaction summary. */
  maxOutputTokens?: number
  /** The preflight token estimate this request was sized by, for the verbose trace. */
  estimate?: number
  /**
   * Called immediately before the provider is called, after all local request preparation, once per
   * provider call (a native tool search fallback calls again). Latency is measured from here.
   */
  onRequest?: () => void
}

export type StreamRequest = StreamInput & {
  abort: AbortSignal
}

export interface Interface {
  readonly stream: (input: StreamInput) => Stream.Stream<LLMEvent, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/LLM") {}

export const use = serviceUse(Service)

const live: Layer.Layer<
  Service,
  never,
  | Auth.Service
  | Config.Service
  | Provider.Service
  | Plugin.Service
  | Permission.Service
  | EventV2Bridge.Service
  | LLMClientService
  | RuntimeFlags.Service
  | OperationHookBridge.Service
  | SessionSpend.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    const plugin = yield* Plugin.Service
    const perm = yield* Permission.Service
    const events = yield* EventV2Bridge.Service
    const llmClient = yield* LLMClient.Service
    const flags = yield* RuntimeFlags.Service
    const hooks = yield* OperationHookBridge.Service
    const spend = yield* SessionSpend.Service

    const run = Effect.fn("LLM.run")(function* (input: StreamRequest, allowNativeSearch: boolean) {
      yield* Effect.logInfo("stream", {
        providerID: input.model.providerID,
        modelID: input.model.id,
        "session.id": input.sessionID,
        small: (input.small ?? false).toString(),
        agent: input.agent.name,
        mode: input.agent.mode,
      })
      yield* Verbose.log("provider.request", () => ({
        sessionID: input.sessionID,
        providerID: input.model.providerID,
        modelID: input.model.id,
        agent: input.agent.name,
        small: input.small ?? false,
        messages: input.messages.length,
        tools: Object.keys(input.tools ?? {}).length,
        // The preflight estimate the loop sized this request by; the provider's count arrives
        // with the response. Requests the loop did not size (a summary) carry none.
        estimatedTokens: input.estimate,
      }))

      const [language, cfg, item, info] = yield* Effect.all(
        [
          provider.getLanguage(input.model),
          config.get(),
          provider.getProvider(input.model.providerID),
          auth.get(input.model.providerID),
        ],
        { concurrency: "unbounded" },
      )

      const isWorkflow = language instanceof GitLabWorkflowLanguageModel
      const prepared = yield* LLMRequestPrep.prepare({
        ...input,
        provider: item,
        auth: info,
        plugin,
        flags,
        isWorkflow,
        hooks,
      })

      // Provider-native tool search, as SessionTools chose it for this step (a fallback attempt
      // runs without it). History keeps only search parts the request can replay, and a deferred
      // tool the history calls stays advertised when the client-side search is in use.
      const search = allowNativeSearch ? NativeToolSearch.modeOf(prepared.tools, input.model) : undefined
      // A retry after a rejection sends tool_search, so the deferred tool hint must name it.
      const fallback = !allowNativeSearch && ToolSearch.nativeOf(prepared.tools) !== undefined
      const messages = NativeToolSearch.history(
        fallback ? NativeToolSearch.clientHint(prepared.messages) : prepared.messages,
        search,
        new Set(Object.keys(prepared.tools)),
      )
      const nativeSearch = search ? NativeToolSearch.aiSdk(prepared.tools, search) : undefined
      const called = NativeToolSearch.called(messages)
      const activeTools = nativeSearch?.active ?? [
        ...ToolSearch.activeNames(prepared.tools),
        ...ToolSearch.deferredNames(prepared.tools).filter((name) => called.has(name)),
      ]

      // Wire up toolExecutor for DWS workflow models so that tool calls
      // from the workflow service are executed via opencode's tool system
      // and results sent back over the WebSocket.
      const bridge = yield* EffectBridge.make()
      if (language instanceof GitLabWorkflowLanguageModel) {
        const workflowModel = language as GitLabWorkflowLanguageModel & {
          sessionID?: string
          sessionPreapprovedTools?: string[]
          approvalHandler?: (approvalTools: { name: string; args: string }[]) => Promise<{ approved: boolean }>
        }
        workflowModel.sessionID = input.sessionID
        workflowModel.systemPrompt = prepared.system.join("\n")
        workflowModel.toolExecutor = async (toolName, argsJson, _requestID) => {
          const t = prepared.tools[toolName]
          if (!t || !t.execute) {
            return { result: "", error: `Unknown tool: ${toolName}` }
          }
          try {
            const result = await t.execute!(JSON.parse(argsJson), {
              toolCallId: _requestID,
              messages: input.messages,
              abortSignal: input.abort,
            })
            const output = typeof result === "string" ? result : (result?.output ?? JSON.stringify(result))
            return {
              result: output,
              metadata: typeof result === "object" ? result?.metadata : undefined,
              title: typeof result === "object" ? result?.title : undefined,
            }
          } catch (e: any) {
            return { result: "", error: e.message ?? String(e) }
          }
        }

        const ruleset = Permission.merge(input.agent.permission ?? [], input.permission ?? [])
        workflowModel.sessionPreapprovedTools = Object.keys(prepared.tools).filter((name) => {
          const match = ruleset.findLast((rule) => Wildcard.match(name, rule.permission))
          return !match || match.action !== "ask"
        })

        const approvedToolsForSession = new Set<string>()
        workflowModel.approvalHandler = bridge.bind(async (approvalTools) => {
          const uniqueNames = [...new Set(approvalTools.map((t: { name: string }) => t.name))] as string[]
          // Auto-approve tools that were already approved in this session
          // (prevents infinite approval loops for server-side MCP tools)
          if (uniqueNames.every((name) => approvedToolsForSession.has(name))) {
            return { approved: true }
          }

          const id = PermissionV1.ID.ascending()
          let unsub: EventV2.Unsubscribe | undefined
          try {
            unsub = await bridge.promise(
              events.listen((event) => {
                if (event.type !== Permission.Event.Replied.type) return Effect.void
                const data = event.data as EventV2.Data<typeof Permission.Event.Replied>
                if (data.requestID !== id) return Effect.void
                void data.reply
                return Effect.void
              }),
            )
            const toolPatterns = approvalTools.map((t: { name: string; args: string }) => {
              try {
                const parsed = JSON.parse(t.args) as Record<string, unknown>
                const title = (parsed?.title ?? parsed?.name ?? "") as string
                return title ? `${t.name}: ${title}` : t.name
              } catch {
                return t.name
              }
            })
            const uniquePatterns = [...new Set(toolPatterns)] as string[]
            await bridge.promise(
              perm.ask({
                id,
                sessionID: SessionID.make(input.sessionID),
                permission: "workflow_tool_approval",
                patterns: uniquePatterns,
                metadata: { tools: approvalTools },
                always: uniquePatterns,
                ruleset: [],
              }),
            )
            for (const name of uniqueNames) approvedToolsForSession.add(name)
            workflowModel.sessionPreapprovedTools = [...(workflowModel.sessionPreapprovedTools ?? []), ...uniqueNames]
            return { approved: true }
          } catch {
            return { approved: false }
          } finally {
            if (unsub) await bridge.promise(unsub)
          }
        })
      }

      const tracer = cfg.experimental?.openTelemetry
        ? Option.getOrUndefined(yield* Effect.serviceOption(OtelTracer.OtelTracer))
        : undefined
      const telemetryTracer = tracer
        ? new Proxy(tracer, {
            get(target, prop, receiver) {
              if (prop !== "startSpan") return Reflect.get(target, prop, receiver)
              return (...args: Parameters<typeof target.startSpan>) => {
                const span = target.startSpan(...args)
                span.setAttribute("session.id", input.sessionID)
                return span
              }
            },
          })
        : undefined

      // Runtime seam: native is an opt-in adapter over @reddb-io/redcode-llm. It
      // either returns a ready LLMEvent stream or a concrete fallback reason.
      if (flags.experimentalNativeLlm) {
        const native = LLMNativeRuntime.stream({
          model: input.model,
          provider: item,
          auth: info,
          llmClient,
          messages,
          // As on the AI SDK path: every tool is dispatchable, only the active ones are sent.
          tools: prepared.tools,
          ...(search === "anthropic"
            ? (() => {
                const plan = NativeToolSearch.native(prepared.tools)
                return { advertise: plan.advertise, toolSearch: { deferred: plan.deferred } }
              })()
            : { advertise: activeTools }),
          toolChoice: input.toolChoice,
          temperature: prepared.params.temperature,
          topP: prepared.params.topP,
          topK: prepared.params.topK,
          maxOutputTokens: prepared.params.maxOutputTokens,
          providerOptions: prepared.params.options,
          headers: prepared.headers,
          abort: input.abort,
        })
        if (native.type === "supported") {
          yield* Effect.logInfo("llm runtime selected", {
            "llm.runtime": "native",
            "llm.provider": input.model.providerID,
            "llm.model": input.model.id,
          })
          return {
            type: "native" as const,
            // The native stream lowers the request eagerly and calls the provider when it is run.
            stream: Stream.unwrap(
              Effect.sync(() => {
                input.onRequest?.()
                return native.stream
              }),
            ),
            search,
          }
        }
        yield* Effect.logInfo("llm runtime selected", {
          "llm.runtime": "ai-sdk",
          "llm.provider": input.model.providerID,
          "llm.model": input.model.id,
          "llm.native_unsupported_reason": native.reason,
        })
        yield* Effect.logInfo("native runtime unavailable; falling back to ai-sdk", {
          providerID: input.model.providerID,
          modelID: input.model.id,
          "session.id": input.sessionID,
          small: (input.small ?? false).toString(),
          agent: input.agent.name,
          mode: input.agent.mode,
          reason: native.reason,
        })
      }

      yield* Effect.logInfo("llm runtime selected", {
        "llm.runtime": "ai-sdk",
        "llm.provider": input.model.providerID,
        "llm.model": input.model.id,
      })
      // Default runtime path: AI SDK owns provider execution and tool dispatch;
      // LLMAISDK.toLLMEvents below normalizes fullStream parts for the processor.
      input.onRequest?.()
      return {
        type: "ai-sdk" as const,
        search,
        result: streamText({
          onError(error) {
            bridge.fork(
              Effect.logError("stream error", {
                providerID: input.model.providerID,
                modelID: input.model.id,
                "session.id": input.sessionID,
                small: (input.small ?? false).toString(),
                agent: input.agent.name,
                mode: input.agent.mode,
                error,
              }),
            )
          },
          // Copilot returns the authoritative billed amount only in provider-specific response fields.
          includeRawChunks: input.model.providerID.includes("github-copilot"),
          async experimental_repairToolCall(failed) {
            const lower = failed.toolCall.toolName.toLowerCase()
            if (lower !== failed.toolCall.toolName && prepared.tools[lower]) {
              return {
                ...failed.toolCall,
                toolName: lower,
              }
            }
            return {
              ...failed.toolCall,
              input: JSON.stringify({
                tool: failed.toolCall.toolName,
                error: NoSuchToolError.isInstance(failed.error)
                  ? unknownToolMessage(failed.toolCall.toolName, ToolSearch.activeNames(prepared.tools), {
                      deferred: ToolSearch.deferredNames(prepared.tools),
                    })
                  : failed.error.message,
              }),
              toolName: "invalid",
            }
          },
          temperature: prepared.params.temperature,
          topP: prepared.params.topP,
          topK: prepared.params.topK,
          providerOptions: ProviderTransform.providerOptions(input.model, prepared.params.options),
          // The SDK sends only activeTools to the provider but validates calls against every tool,
          // so a deferred tool is unadvertised yet still callable. With native search, deferred
          // tools are advertised flagged and the provider search tool replaces tool_search.
          activeTools,
          tools: nativeSearch?.tools ?? prepared.tools,
          toolChoice: input.toolChoice,
          maxOutputTokens: prepared.params.maxOutputTokens,
          abortSignal: input.abort,
          headers: prepared.headers,
          maxRetries: input.retries ?? 0,
          messages,
          model: wrapLanguageModel({
            model: language,
            middleware: [
              {
                specificationVersion: "v3" as const,
                async transformParams(args) {
                  if (args.type === "stream") {
                    // @ts-expect-error
                    args.params.prompt = ProviderTransform.message(
                      args.params.prompt,
                      input.model,
                      prepared.messageTransformOptions,
                    )
                  }
                  return args.params
                },
              },
            ],
          }),
          experimental_telemetry: {
            isEnabled: cfg.experimental?.openTelemetry,
            functionId: "session.llm",
            tracer: telemetryTracer,
            metadata: {
              userId: cfg.username ?? "unknown",
              sessionId: input.sessionID,
            },
          },
        }),
      }
    })

    const attempt = (input: StreamInput, allowNativeSearch: boolean): Stream.Stream<LLMEvent, unknown> =>
      Stream.scoped(
        Stream.unwrap(
          Effect.gen(function* () {
            const ctrl = yield* Effect.acquireRelease(
              Effect.sync(() => new AbortController()),
              (ctrl) => Effect.sync(() => ctrl.abort()),
            )

            const result = yield* run({ ...input, abort: ctrl.signal }, allowNativeSearch)

            // Adapter seam: both runtimes expose the same LLMEvent stream. Native
            // already returns one; AI SDK streams are converted here.
            const events =
              result.type === "native"
                ? result.stream
                : (() => {
                    const state = LLMAISDK.adapterState()
                    return Stream.fromAsyncIterable(result.result.fullStream, (e) =>
                      e instanceof Error ? e : new Error(String(e)),
                    ).pipe(
                      Stream.mapEffect((event) => LLMAISDK.toLLMEvents(state, event)),
                      Stream.flatMap((events) => Stream.fromIterable(events)),
                    )
                  })()
            if (!result.search) return events

            // A provider or proxy that does not know the search tool or its deferral answers 400
            // before streaming anything. Retry this request once with client-side tool_search, and
            // keep native search off for this model for the rest of the process only once that
            // retry gets an answer: if it fails too, the 400 was not about native search.
            let started = false
            return events.pipe(
              Stream.tap(() =>
                Effect.sync(() => {
                  started = true
                }),
              ),
              Stream.catchCause((cause) => {
                const error = Cause.squash(cause)
                if (started || !NativeToolSearch.isRejection(error)) return Stream.failCause(cause)
                // An unresolvable reference is a history problem, not missing support.
                let remembered = NativeToolSearch.isMissingReference(error)
                const retry = attempt(input, false).pipe(
                  Stream.tap(() =>
                    Effect.sync(() => {
                      if (remembered) return
                      remembered = true
                      NativeToolSearch.reject(input.model)
                    }),
                  ),
                )
                return Stream.unwrap(
                  Effect.logWarning("provider rejected native tool search; retrying with tool_search", {
                    providerID: input.model.providerID,
                    modelID: input.model.id,
                    "session.id": input.sessionID,
                    mode: result.search,
                    error: error instanceof Error ? error.message : String(error),
                  }).pipe(Effect.as(retry)),
                )
              }),
            )
          }),
        ),
      )

    const stream: Interface["stream"] = (input) =>
      attempt(input, true).pipe(
        // Every provider call passes here — turns, subagents, compaction, titles, the goal judge — so
        // this is the one place spend is counted. A step reports its own usage; `finish` repeats the total.
        // The tap sits outside `attempt` so a native tool search fallback, which re-enters `attempt`,
        // is still counted once.
        Stream.tap((event) =>
          event.type === "step-finish" && event.usage
            ? spend.record({
                sessionID: input.sessionID,
                model: input.model,
                usage: event.usage,
                metadata: event.providerMetadata,
              })
            : Effect.void,
        ),
      )

    return Service.of({ stream })
  }),
)

export const hasToolCalls = LLMRequestPrep.hasToolCalls

export const node = LayerNode.make({
  service: Service,
  layer: live,
  deps: [
    Auth.node,
    Config.node,
    Provider.node,
    Plugin.node,
    Permission.node,
    EventV2Bridge.node,
    llmClient,
    RuntimeFlags.node,
    OperationHookBridge.node,
    SessionSpend.node,
  ],
})

export * as LLM from "./llm"
