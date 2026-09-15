export * as ToolRegistry from "./registry"
import { RepositoryGuard } from "../repository-guard"

import { ToolDefinition, ToolOutput, type ToolCall, type ToolResultValue } from "@reddb-io/redcode-llm"
import { Context, Effect, Layer, Scope } from "effect"
import { AgentV2 } from "../agent"
import { PermissionV2 } from "../permission"
import { SessionMessage } from "../session/message"
import { SessionSchema } from "../session/schema"
import { ToolOutputStore } from "../tool-output-store"
import { Wildcard } from "../util/wildcard"
import { ApplicationTools } from "./application-tools"
import {
  definition,
  isExternal,
  media,
  permission,
  settle,
  validateName,
  type AnyTool,
  type RegistrationError,
} from "./tool"
import { Tools } from "./tools"
import { ToolSearch } from "./tool-search"
import { makeLocationNode } from "../effect/app-node"

export type ExecuteInput = {
  readonly sessionID: SessionSchema.ID
  readonly agent: AgentV2.ID
  readonly assistantMessageID: SessionMessage.ID
  readonly call: ToolCall
}

/**
 * Progressive discovery for one step. The registry knows which tools are external (MCP or plugin)
 * and what each one advertises, so it builds the deferrable entries itself; the runner supplies
 * only what it alone knows: the configuration, the Session's history and the model's capability.
 */
export interface Deferral {
  readonly config?: ToolSearch.Config
  /** MCP server names, so a flat `<server>_<tool>` key maps back to its namespace. */
  readonly servers?: ReadonlyArray<string>
  /** Whether this Session has a Design context; Design tools are only deferred outside one. */
  readonly designContext?: boolean
  /** Deferral already tripped earlier in this Session, from its history. */
  readonly tripped?: boolean
  /** Deferred tools already loaded in this Session, in activation order. */
  readonly loaded?: ReadonlyArray<string>
  /** Provider-native search mode, when the protocol carries it. */
  readonly native?: "anthropic"
}

export interface MaterializeOptions {
  readonly permissions?: PermissionV2.Ruleset
  readonly deferral?: Deferral
}

export interface Interface {
  readonly materialize: (options?: PermissionV2.Ruleset | MaterializeOptions) => Effect.Effect<Materialization>
  /** Internal registration capability exposed publicly only through Tools.Service. */
  readonly register: (tools: Readonly<Record<string, AnyTool>>) => Effect.Effect<void, RegistrationError, Scope.Scope>
}

export interface Materialization {
  readonly media: ReadonlyArray<{ name: string; capability: NonNullable<ReturnType<typeof media>> }>
  readonly definitions: ReadonlyArray<ToolDefinition>
  readonly settle: (input: ExecuteInput) => Effect.Effect<Settlement, ToolOutputStore.Error>
  /** The deferred tool index for the system context, when this step defers anything. */
  readonly toolIndex?: string
  /** Provider-native search mode this step advertises, if any. */
  readonly native?: "anthropic"
}

export interface Settlement {
  readonly result: ToolResultValue
  readonly output?: ToolOutput
  readonly outputPaths?: ReadonlyArray<string>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/v2/ToolRegistry") {}

const registryLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const applications = yield* ApplicationTools.Service
    const resources = yield* ToolOutputStore.Service
    type Registration = { readonly identity: object; readonly tool: AnyTool }
    const local = new Map<string, Array<{ readonly token: object; readonly registration: Registration }>>()

    // Built-in tools always win a name: an MCP server called `design` must not replace `design_preview`,
    // whatever order the layers registered in. Local built-ins, then application tools, then external.
    const resolve = (name: string): Registration | undefined => {
      const entries = local.get(name)
      const builtin = entries?.findLast((entry) => !isExternal(entry.registration.tool))?.registration
      return builtin ?? applications.entries().get(name) ?? entries?.at(-1)?.registration
    }

    const settleWith = Effect.fn("ToolRegistry.settle")(function* (input: ExecuteInput, advertised?: object) {
      const registration = resolve(input.call.name)
      if (!registration)
        return {
          result: {
            type: "error" as const,
            value: advertised ? `Stale tool call: ${input.call.name}` : `Unknown tool: ${input.call.name}`,
          },
        }
      if (advertised && registration.identity !== advertised)
        return { result: { type: "error" as const, value: `Stale tool call: ${input.call.name}` } }
      const pending = yield* settle(registration.tool, input.call, {
        sessionID: input.sessionID,
        agent: input.agent,
        assistantMessageID: input.assistantMessageID,
        toolCallID: input.call.id,
      }).pipe(
        Effect.map((output) => ({ output })),
        Effect.catchTag("LLM.ToolFailure", (failure) =>
          Effect.succeed({ result: { type: "error" as const, value: failure.message } }),
        ),
      )
      if ("result" in pending) return pending
      const output = pending.output
      const bounded = yield* resources.bound({ sessionID: input.sessionID, toolCallID: input.call.id, output })
      const result = ToolOutput.toResultValue(bounded.output)
      if (result.type === "error")
        return bounded.outputPaths.length > 0 ? { result, outputPaths: bounded.outputPaths } : { result }
      return bounded.outputPaths.length > 0
        ? { result, output: bounded.output, outputPaths: bounded.outputPaths }
        : { result, output: bounded.output }
    })

    return Service.of({
      register: Effect.fn("ToolRegistry.register")(function* (tools) {
        const entries = Object.entries(tools)
        if (entries.length === 0) return
        yield* Effect.forEach(entries, ([name]) => validateName(name), { discard: true })
        for (const [name, tool] of entries) {
          const others = [
            ...(local.get(name) ?? []).map((entry) => entry.registration.tool),
            ...(applications.entries().has(name) ? [applications.entries().get(name)!.tool] : []),
          ]
          const collides = isExternal(tool)
            ? others.some((other) => !isExternal(other))
            : others.some((other) => isExternal(other))
          if (collides)
            yield* Effect.logWarning(
              `External tool "${name}" has the same name as a built-in tool; the built-in tool is used`,
            )
        }
        yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const token = {}
            for (const [name, tool] of entries)
              local.set(name, [...(local.get(name) ?? []), { token, registration: { identity: {}, tool } }])
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                for (const [name] of entries) {
                  const registrations = local.get(name)?.filter((registration) => registration.token !== token) ?? []
                  if (registrations.length > 0) local.set(name, registrations)
                  else local.delete(name)
                }
              }),
            )
          }),
        )
      }),
      materialize: Effect.fn("ToolRegistry.materialize")(function* (options = []) {
        // Callers pass either a bare ruleset (the original signature) or the options object.
        const input: MaterializeOptions = Array.isArray(options)
          ? { permissions: options as PermissionV2.Ruleset }
          : (options as MaterializeOptions)
        const permissions = input.permissions ?? []
        const registrations = new Map<string, Registration>()
        for (const name of new Set([...applications.entries().keys(), ...local.keys()])) {
          const registration = resolve(name)
          if (registration) registrations.set(name, registration)
        }
        for (const [name, registration] of registrations)
          if (whollyDisabled(permission(registration.tool, name), permissions)) registrations.delete(name)
        // Deferrable tools are built from what survived the permission filter, so the index never
        // lists, and `tool_search` never loads, a tool this request would drop anyway.
        const entry = (name: string, registration: Registration, namespace: string): ToolSearch.Entry => {
          const advertised = definition(name, registration.tool)
          return {
            name,
            namespace,
            description: advertised.description,
            schema: (advertised.inputSchema ?? {}) as Record<string, unknown>,
          }
        }
        const mcp: ToolSearch.Entry[] = []
        const design: ToolSearch.Entry[] = []
        if (input.deferral) {
          const servers = input.deferral.servers ?? []
          for (const [name, registration] of registrations) {
            if (isExternal(registration.tool))
              mcp.push(entry(name, registration, ToolSearch.namespaceOf(name, servers)))
            else if (name.startsWith(ToolSearch.DESIGN_NAMESPACE + "_"))
              design.push(entry(name, registration, ToolSearch.DESIGN_NAMESPACE))
          }
        }
        const deferrable = input.deferral
          ? ToolSearch.plan({
              config: input.deferral.config,
              mcp,
              design,
              designContext: input.deferral.designContext ?? true,
              tripped: input.deferral.tripped,
            })
          : []
        const loaded = new Set((input.deferral?.loaded ?? []).filter((name) => registrations.has(name)))
        const native = deferrable.length > 0 ? input.deferral?.native : undefined
        // Present whenever anything is deferrable, even once all of it is loaded: removing the tool
        // later would rewrite the advertised prefix. Its description is static; the index rides the
        // system context.
        const pending = new Set(deferrable.filter((entry) => !loaded.has(entry.name)).map((entry) => entry.name))
        const searchTool =
          deferrable.length > 0 && native === undefined
            ? new ToolDefinition({
                name: ToolSearch.TOOL_ID,
                description: ToolSearch.DESCRIPTION,
                inputSchema: ToolSearch.InputSchema as never,
              })
            : undefined
        const definitions = Array.from(registrations, ([name, registration]) => {
          const base = definition(name, registration.tool)
          if (!pending.has(name)) return base
          // Native search sends every deferred definition flagged; the client-side tool withholds
          // them entirely and loads them by name from the next step.
          return native ? ToolDefinition.make({ ...base, deferLoading: true }) : base
        }).filter((item) => native !== undefined || !pending.has(item.name))
        return {
          media: Array.from(registrations).flatMap(([name, registration]) => {
            const capability = media(registration.tool)
            return capability ? [{ name, capability }] : []
          }),
          definitions: searchTool ? [...definitions, searchTool] : definitions,
          ...(deferrable.length > 0 ? { toolIndex: ToolSearch.indexText(deferrable, native !== undefined) } : {}),
          ...(native ? { native } : {}),
          settle: (call) => {
            // A call to a deferred tool still runs: the model may name one the index listed, and a
            // replayed call must never become a stale-tool error.
            if (call.call.name === ToolSearch.TOOL_ID && searchTool) {
              const active = new Set(Array.from(registrations.keys()).filter((name) => !pending.has(name)))
              const args = (call.call.input ?? {}) as { query?: unknown; select?: unknown; limit?: unknown }
              // A call with neither query nor select is the model's mistake, not a crash: it reads
              // back as an ordinary tool error.
              const result = Effect.try({
                try: () => ToolSearch.run(deferrable, active, args),
                catch: (error) => (error instanceof Error ? error.message : String(error)),
              })
              return result.pipe(
                Effect.map((value): Settlement => {
                  const output = ToolOutput.make({ ...value.metadata }, [{ type: "text", text: value.output }])
                  return { result: ToolOutput.toResultValue(output), output }
                }),
                Effect.catch((message) => Effect.succeed<Settlement>({ result: { type: "error", value: message } })),
              )
            }
            const registration = registrations.get(call.call.name)
            if (registration) return settleWith(call, registration.identity)
            return Effect.succeed({ result: { type: "error", value: `Unknown tool: ${call.call.name}` } })
          },
        }
      }),
    })
  }),
)

const layer = Layer.effect(
  Tools.Service,
  Service.use((registry) => Effect.succeed(Tools.Service.of({ register: registry.register }))),
).pipe(Layer.provideMerge(registryLayer))

function whollyDisabled(action: string, rules: PermissionV2.Ruleset) {
  if (RepositoryGuard.yolo()) return false
  const rule = rules.findLast((rule) => Wildcard.match(action, rule.action))
  return rule?.resource === "*" && rule.effect === "deny"
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [ApplicationTools.node, ToolOutputStore.node],
})

export const toolsNode = makeLocationNode({
  service: Tools.Service,
  layer,
  deps: [ApplicationTools.node, ToolOutputStore.node],
})
