import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import type {
  Hooks,
  PluginInput,
  Plugin as PluginInstance,
  PluginModule,
  WorkspaceAdapter as PluginWorkspaceAdapter,
} from "@reddb-io/redcode-plugin"
import { Config } from "@/config/config"
import { createRedcodeClient } from "@reddb-io/redcode-sdk"
import { ServerAuth } from "@/server/auth"
import { CodexAuthPlugin } from "./openai/codex"
import { Session } from "@/session/session"
import { NamedError } from "@reddb-io/redcode-core/util/error"
import { CopilotAuthPlugin } from "./github-copilot/copilot"
import { ModalPlugin } from "./modal/modal"
import { gitlabAuthPlugin as GitlabAuthPlugin } from "opencode-gitlab-auth"
import { PoeAuthPlugin } from "opencode-poe-auth"
import { CloudflareAIGatewayAuthPlugin, CloudflareWorkersAuthPlugin } from "./cloudflare"
import { AzureAuthPlugin } from "./azure"
import { DigitalOceanAuthPlugin } from "./digitalocean"
import { XaiAuthPlugin } from "./xai"
import { SnowflakeCortexAuthPlugin } from "./snowflake-cortex"
import { Effect, Layer, Context } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { InstanceState } from "@/effect/instance-state"
import { errorMessage } from "@/util/error"
import { PluginLoader } from "./loader"
import { parsePluginSpecifier, readPluginId, readV1Plugin, resolvePluginId } from "./shared"
import { registerAdapter } from "@/control-plane/adapters"
import type { WorkspaceAdapter } from "@/control-plane/types"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstallationChannel } from "@reddb-io/redcode-core/installation/version"
import { HookV2 } from "@reddb-io/redcode-core/hook"
import { LocationServiceMap, locationServiceMapLayer } from "@reddb-io/redcode-core/location-services"
import { Location } from "@reddb-io/redcode-core/location"
import { AbsolutePath } from "@reddb-io/redcode-core/schema"
import { Hook } from "@reddb-io/redcode-schema/hook"
import { isRecord } from "@/util/record"

type State = {
  hooks: Hooks[]
}

// Hook names that follow the (input, output) => Promise<void> trigger pattern
type TriggerName = {
  [K in keyof Hooks]-?: NonNullable<Hooks[K]> extends (input: any, output: any) => Promise<void> ? K : never
}[keyof Hooks]

export interface Interface {
  readonly trigger: <
    Name extends TriggerName,
    Input = Parameters<Required<Hooks>[Name]>[0],
    Output = Parameters<Required<Hooks>[Name]>[1],
  >(
    name: Name,
    input: Input,
    output: Output,
  ) => Effect.Effect<Output>
  readonly list: () => Effect.Effect<Hooks[]>
  readonly init: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/Plugin") {}

export function experimentalWebSocketsEnabled(input: { enabled: boolean; channel?: string }) {
  return input.enabled || ["local", "dev", "beta"].includes(input.channel ?? InstallationChannel)
}

// Built-in plugins that are directly imported (not installed from npm)
function internalPlugins(flags: RuntimeFlags.Info): PluginInstance[] {
  return [
    // Temporary rollout: pre-release builds use WebSockets by default; releases require explicit opt-in.
    (input) =>
      CodexAuthPlugin(input, {
        experimentalWebSockets: experimentalWebSocketsEnabled({ enabled: flags.experimentalWebSockets }),
      }),
    CopilotAuthPlugin,
    ModalPlugin,
    GitlabAuthPlugin,
    PoeAuthPlugin,
    CloudflareWorkersAuthPlugin,
    CloudflareAIGatewayAuthPlugin,
    AzureAuthPlugin,
    DigitalOceanAuthPlugin,
    SnowflakeCortexAuthPlugin,
    XaiAuthPlugin,
  ]
}

function isServerPlugin(value: unknown): value is PluginInstance {
  return typeof value === "function"
}

function getServerPlugin(value: unknown) {
  if (isServerPlugin(value)) return value
  if (!value || typeof value !== "object" || !("server" in value)) return
  if (!isServerPlugin(value.server)) return
  return value.server
}

function getLegacyPlugins(mod: Record<string, unknown>) {
  const seen = new Set<unknown>()
  const result: PluginInstance[] = []

  for (const entry of Object.values(mod)) {
    if (seen.has(entry)) continue
    seen.add(entry)
    const plugin = getServerPlugin(entry)
    if (!plugin) throw new TypeError("Plugin export is not a function")
    result.push(plugin)
  }

  return result
}

async function applyPlugin(load: PluginLoader.Loaded, input: PluginInput, hooks: Hooks[]) {
  const plugin = readV1Plugin(load.mod, load.spec, "server", "detect")
  if (plugin) {
    await resolvePluginId(load.source, load.spec, load.target, readPluginId(plugin.id, load.spec), load.pkg)
    Effect.logWarning(
      `[plugin] V1 plugin "${readPluginId(plugin.id, load.spec)}" loaded via legacy server() hook — V1 hooks (chat.message, tool.execute.before, etc.) are deprecated and will be removed in the next major release. Migrate to the V2 plugin context: ctx.agent, ctx.command, ctx.skill, ctx.capability.`,
    ).pipe(Effect.runSync)
    hooks.push(await (plugin as PluginModule).server(input, load.options))
    return
  }

  for (const server of getLegacyPlugins(load.mod)) {
    hooks.push(await server(input, load.options))
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const config = yield* Config.Service
    const flags = yield* RuntimeFlags.Service
    const locations = yield* LocationServiceMap.Service

    const state = yield* InstanceState.make<State>(
      Effect.fn("Plugin.state")(function* (ctx) {
        const hooks: Hooks[] = []
        const bridge = yield* EffectBridge.make()

        function publishPluginError(message: string) {
          bridge.fork(events.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() }))
        }

        const { Server } = yield* Effect.promise(() => import("../server/server"))

        const serverUrl = Server.url
        const client = createRedcodeClient({
          baseUrl: serverUrl?.toString() ?? "http://localhost:4096",
          directory: ctx.directory,
          headers: ServerAuth.headers(),
          ...(serverUrl ? {} : { fetch: async (...args) => Server.Default().app.fetch(...args) }),
        })
        const cfg = yield* config.get()
        const input: PluginInput = {
          client,
          project: ctx.project,
          worktree: ctx.worktree,
          directory: ctx.directory,
          experimental_workspace: {
            register(type: string, adapter: PluginWorkspaceAdapter) {
              registerAdapter(ctx.project.id, type, adapter as WorkspaceAdapter)
            },
          },
          get serverUrl(): URL {
            return Server.url ?? new URL("http://localhost:4096")
          },
          // @ts-expect-error
          $: typeof Bun === "undefined" ? undefined : Bun.$,
        }

        for (const plugin of flags.disableDefaultPlugins ? [] : internalPlugins(flags)) {
          const init = yield* Effect.tryPromise({
            try: () => plugin(input),
            catch: errorMessage,
          }).pipe(
            Effect.tapError((error) => Effect.logError("failed to load internal plugin", { name: plugin.name, error })),
            Effect.option,
          )
          if (init._tag === "Some") hooks.push(init.value)
        }

        const plugins = flags.pure ? [] : (cfg.plugin_origins ?? [])
        if (flags.pure && cfg.plugin_origins?.length) {
        }
        if (plugins.length) yield* config.waitForDependencies()

        const loaded = yield* Effect.promise(() =>
          PluginLoader.loadExternal({
            items: plugins,
            kind: "server",
            report: {
              start(candidate) {},
              missing(candidate, _retry, message) {},
              error(candidate, _retry, stage, error, resolved) {
                const spec = candidate.plan.spec
                const cause = error instanceof Error ? (error.cause ?? error) : error
                const message = stage === "load" ? errorMessage(error) : errorMessage(cause)

                if (stage === "install") {
                  const parsed = parsePluginSpecifier(spec)
                  publishPluginError(`Failed to install plugin ${parsed.pkg}@${parsed.version}: ${message}`)
                  return
                }

                if (stage === "compatibility") {
                  publishPluginError(`Plugin ${spec} skipped: ${message}`)
                  return
                }

                if (stage === "entry") {
                  publishPluginError(`Failed to load plugin ${spec}: ${message}`)
                  return
                }

                publishPluginError(`Failed to load plugin ${spec}: ${message}`)
              },
            },
          }),
        )
        for (const load of loaded) {
          if (!load) continue

          // Keep plugin execution sequential so hook registration and execution
          // order remains deterministic across plugin runs.
          yield* Effect.tryPromise({
            try: () => applyPlugin(load, input, hooks),
            catch: (err) => {
              const message = errorMessage(err)
              return message
            },
          }).pipe(
            Effect.tapError((error) => Effect.logError("failed to load plugin", { path: load.spec, error })),
            Effect.catch(() => {
              // TODO: make proper events for this
              // events.publish(Session.Event.Error, {
              //   error: new NamedError.Unknown({
              //     message: `Failed to load plugin ${load.spec}: ${message}`,
              //   }).toObject(),
              // })
              return Effect.void
            }),
          )
        }

        // Notify plugins of current config
        for (const hook of hooks) {
          yield* Effect.tryPromise({
            try: () => Promise.resolve((hook as any).config?.(cfg)),
            catch: errorMessage,
          }).pipe(
            Effect.tapError((error) => Effect.logError("plugin config hook failed", { error })),
            Effect.ignore,
          )
        }

        const unsubscribe = yield* events.listen((event) => {
          if (event.location?.directory !== ctx.directory) return Effect.void
          return Effect.gen(function* () {
            const declarative = eventInput(event.type, event.data)
            if (declarative) {
              const ref = Location.Ref.make({
                directory: AbsolutePath.make(ctx.directory),
                ...(event.location?.workspaceID ? { workspaceID: event.location.workspaceID } : {}),
              })
              yield* HookV2.Service.use((service) => service.run(declarative)).pipe(
                Effect.provide(locations.get(ref)),
                Effect.tapError((error) => Effect.logWarning("declarative event hook failed", { error })),
                Effect.ignore,
              )
            }
            yield* Effect.sync(() => {
              for (const hook of hooks) {
                void hook["event"]?.({ event: { id: event.id, type: event.type, properties: event.data } as any })
              }
            })
          })
        })
        yield* Effect.addFinalizer(() => unsubscribe)

        yield* Effect.addFinalizer(() =>
          Effect.forEach(
            hooks,
            (hook) =>
              Effect.tryPromise({
                try: () => Promise.resolve(hook.dispose?.()),
                catch: errorMessage,
              }).pipe(
                Effect.tapError((error) => Effect.logError("plugin dispose hook failed", { error })),
                Effect.ignore,
              ),
            { discard: true },
          ),
        )

        return { hooks }
      }),
    )

    const trigger = Effect.fn("Plugin.trigger")(function* <
      Name extends TriggerName,
      Input = Parameters<Required<Hooks>[Name]>[0],
      Output = Parameters<Required<Hooks>[Name]>[1],
    >(name: Name, input: Input, output: Output) {
      if (!name) return output
      const ctx = yield* InstanceState.context
      const workspaceID = yield* InstanceState.workspaceID
      const hookInput = declarativeInput(name, input, output)
      if (hookInput) {
        const decision = yield* HookV2.Service.use((hooks) => hooks.run(hookInput)).pipe(
          Effect.provide(
            locations.get(
              Location.Ref.make({
                directory: AbsolutePath.make(ctx.directory),
                ...(workspaceID ? { workspaceID } : {}),
              }),
            ),
          ),
        )
        if (decision.updatedInput !== undefined && name === "tool.execute.before") {
          if (isRecord(output)) Object.assign(output, { args: decision.updatedInput })
        }
        if (!decision.continue || decision.decision === "deny")
          return yield* Effect.die(
            new HookV2.BlockedError({
              event: hookInput.event,
              reason: decision.reason ?? `${hookInput.event} hook denied the operation`,
            }),
          )
      }
      const s = yield* InstanceState.get(state)
      for (const hook of s.hooks) {
        const fn = hook[name] as any
        if (!fn) continue
        yield* Effect.promise(async () => fn(input, output))
      }
      return output
    })

    const list = Effect.fn("Plugin.list")(function* () {
      const s = yield* InstanceState.get(state)
      return s.hooks
    })

    const init = Effect.fn("Plugin.init")(function* () {
      yield* InstanceState.get(state)
    })

    return Service.of({ trigger, list, init })
  }),
)

function declarativeInput(name: string, input: unknown, output: unknown): Omit<Hook.Input, "cwd"> | undefined {
  const source = isRecord(input) ? input : {}
  const result = isRecord(output) ? output : {}
  const sessionID = typeof source.sessionID === "string" ? source.sessionID : undefined
  if (name === "chat.message") {
    const parts = Array.isArray(result.parts) ? result.parts : []
    return {
      event: "UserPromptSubmit",
      session_id: sessionID,
      prompt: parts
        .filter((part): part is { text: string } =>
          Boolean(part && typeof part === "object" && "text" in part && typeof part.text === "string"),
        )
        .map((part) => part.text)
        .join("\n"),
    }
  }
  if (name === "tool.execute.before" || name === "command.execute.before") {
    const tool =
      name === "command.execute.before"
        ? "Command"
        : HookV2.toolName(typeof source.tool === "string" ? source.tool : "")
    return {
      event: "PreToolUse",
      matcher: tool,
      session_id: sessionID,
      tool_name: tool,
      tool_input: name === "command.execute.before" ? source : result.args,
    }
  }
  if (name === "tool.execute.after") {
    const tool = HookV2.toolName(typeof source.tool === "string" ? source.tool : "")
    return {
      event: "PostToolUse",
      matcher: tool,
      session_id: sessionID,
      tool_name: tool,
      tool_input: source.args,
      tool_response: result,
    }
  }
  if (name === "permission.ask")
    return {
      event: "PermissionRequest",
      matcher: typeof source.permission === "string" ? source.permission : "",
      session_id: sessionID,
      message: JSON.stringify(source),
    }
  if (name === "experimental.session.compacting") return { event: "PreCompact", session_id: sessionID, matcher: "auto" }
  return undefined
}

function eventInput(type: string, input: unknown): Omit<Hook.Input, "cwd"> | undefined {
  const data = isRecord(input) ? input : {}
  const sessionID = typeof data.sessionID === "string" ? data.sessionID : undefined
  if (type === "session.created") return { event: "SessionStart", session_id: sessionID, matcher: "startup" }
  if (type === "session.idle") return { event: "Stop", session_id: sessionID, matcher: "stop" }
  if (type !== "message.part.updated") return undefined
  const part = isRecord(data.part) ? data.part : {}
  if (part.type !== "text" || typeof part.text !== "string") return undefined
  return { event: "MessageDisplay", session_id: sessionID, message: part.text }
}

const locationServiceMapNode = LayerNode.make({
  service: LocationServiceMap.Service,
  layer: locationServiceMapLayer,
  deps: [],
})

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [EventV2Bridge.node, Config.node, RuntimeFlags.node, locationServiceMapNode],
})

export * as Plugin from "."
