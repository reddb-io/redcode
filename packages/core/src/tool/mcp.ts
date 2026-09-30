export * as McpTool from "./mcp.js"

import { ToolFailure } from "@opencode/ai"
import { McpEvent } from "@opencode/schema/mcp-event"
import { Context, Effect, Fiber, type JsonSchema, Layer, PubSub, Semaphore, Stream } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Bus } from "../bus.js"

import { Mcp } from "../mcp/index.js"
import { Permission } from "../permission.js"
import { ProviderRouter } from "../provider-router.js"
import { Tool } from "../tool.js"
import { Vault } from "../vault/vault.js"
import { VaultHosts } from "../vault/hosts.js"

/**
 * Registry namespace and permission action names for MCP tools.
 */
export const namespace = (server: string) => server.replace(/[^a-zA-Z0-9_-]/g, "_")
export const name = (server: string, tool: string) => `${namespace(server)}_${tool.replace(/[^a-zA-Z0-9_-]/g, "_")}`

export interface Interface {
  /** Wait for the initial MCP tool registration to settle. */
  readonly flush: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/McpTool") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const mcp = yield* Mcp.Service
    const tools = yield* Tool.Service
    const bus = yield* Bus.Service
    const permission = yield* Permission.Service
    const lock = Semaphore.makeUnsafe(1)
    let discovered: Mcp.Tool[] = []

    // Register once after initial discovery; only subsequent updates need a debounced reload.
    const initial = yield* lock
      .withPermit(
        Effect.gen(function* () {
          discovered = yield* mcp.tools()
          yield* tools.transform((editor) => {
            for (const tool of discovered) {
              editor.add({
                name: tool.name,
                options: { namespace: namespace(tool.server), codemode: tool.codemode !== false },
                description: tool.description ?? "",
                input: (tool.inputSchema ?? { type: "object", properties: {} }) as JsonSchema.JsonSchema,
                output: (tool.outputSchema ?? {}) as JsonSchema.JsonSchema,
                execute: (input, context) =>
                  Effect.gen(function* () {
                    // RedRouter key management always asks, can never be approved for later, and no
                    // rule, saved approval or permission hook answers it for the person.
                    const guarded = ProviderRouter.protectedCall({
                      server: tool.identity ?? tool.server,
                      tool: tool.name,
                      args: input,
                    })
                    yield* permission.assert({
                      action: name(tool.server, tool.name),
                      resources: ["*"],
                      ...(guarded
                        ? { save: [], metadata: { protected: guarded }, force: true }
                        : { save: ["*"], metadata: {} }),
                      sessionID: context.sessionID,
                      agent: context.agent,
                      source: {
                        type: "tool",
                        messageID: context.messageID,
                        id: context.id,
                      },
                    })
                    // Vault references resolve only in the arguments sent to the server; the stored call keeps them.
                    const args = (input ?? {}) as Record<string, unknown>
                    const vaulted = yield* Vault.resolveAll(Vault.references(JSON.stringify(args)))
                    if ("missing" in vaulted)
                      return yield* new ToolFailure({ message: Vault.unknownReference(vaulted.missing) })
                    const server = `mcp:${tool.identity ?? tool.server}`
                    yield* VaultHosts.approve({
                      permission,
                      context,
                      names: Array.from(vaulted.values.keys()),
                      destinations: { known: [server] },
                      detail: { command: name(tool.server, tool.name) },
                    }).pipe(
                      Effect.mapError(
                        (error) =>
                          new ToolFailure({
                            message: "feedback" in error ? `The user declined: ${error.feedback}` : error.message,
                          }),
                      ),
                    )
                    const called = yield* mcp
                      .callTool({
                        server: tool.server,
                        name: tool.name,
                        args: vaulted.values.size === 0 ? args : Vault.fillRecord(args, vaulted.values),
                        sessionID: context.sessionID,
                      })
                      .pipe(
                        Effect.catchTags({
                          "MCP.NotFoundError": (error) =>
                            new ToolFailure({ message: `MCP server "${error.server}" is not available` }),
                          "MCP.ToolCallError": (error) => new ToolFailure({ message: error.message }),
                        }),
                      )
                    // Secrets the server returns, such as a token it issued, are stored and read as references.
                    const binding = yield* Vault.Current
                    const captured = binding
                      ? yield* binding.capture(
                          [
                            ...called.content.flatMap((part) => (part.type === "text" ? [part.text] : [])),
                            ...Vault.strings(called.structured),
                          ],
                          [server],
                        )
                      : undefined
                    const clean = captured?.clean ?? ((text: string) => text)
                    const note = Vault.captureNote(captured?.names ?? [])
                    const result = {
                      isError: called.isError,
                      structured:
                        called.structured === undefined ? undefined : Vault.scrubDeep(called.structured, clean),
                      content: called.content.map((part) =>
                        part.type === "text" ? { ...part, text: clean(part.text) } : part,
                      ),
                    }
                    if (result.isError)
                      return yield* new ToolFailure({
                        message:
                          result.content
                            .flatMap((part) => (part.type === "text" ? [part.text] : []))
                            .join("\n")
                            .trim() || "MCP tool returned an error",
                      })
                    const content = result.content.map((part) =>
                      part.type === "text"
                        ? { type: "text" as const, text: part.text }
                        : {
                            type: "file" as const,
                            uri: `data:${part.mimeType};base64,${part.data}`,
                            mime: part.mimeType,
                          },
                    )
                    const text = content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
                    const output = () => {
                      if (result.structured !== undefined) return result.structured
                      if (text === "") return null
                      // Agents assume JSON returned as text is already an object, so parse it when the server declares no schema.
                      if (tool.outputSchema === undefined && (text.startsWith("{") || text.startsWith("["))) {
                        try {
                          return JSON.parse(text)
                        } catch {}
                      }
                      return text
                    }
                    // The note follows the parsed output, so JSON returned as text still parses.
                    const noted = note ? [...content, { type: "text" as const, text: note }] : content
                    return {
                      output: output(),
                      ...(noted.length === 0 ? {} : { content: noted }),
                    }
                  }).pipe(
                    Effect.mapError((error) =>
                      error instanceof ToolFailure
                        ? error
                        : new ToolFailure({ message: `Unable to execute ${name(tool.server, tool.name)}` }),
                    ),
                  ),
              })
            }
          })
        }),
      )
      .pipe(Effect.forkScoped)
    const reconcile = lock.withPermit(
      Effect.gen(function* () {
        discovered = yield* mcp.tools()
        yield* tools.reload()
      }),
    )

    // Servers announce tools in bursts and each read loads the whole catalog, so settle and refresh
    // once. The bus subscription stays eager; only the already-open sliding subscription is debounced.
    const changes = yield* PubSub.sliding<void>(1)
    yield* bus.subscribe(McpEvent.ToolsChanged).pipe(
      Stream.runForEach(() => PubSub.publish(changes, undefined)),
      Effect.forkScoped({ startImmediately: true }),
    )
    const updates = yield* PubSub.subscribe(changes)
    yield* Stream.fromSubscription(updates).pipe(
      Stream.debounce("100 millis"),
      Stream.runForEach(() => reconcile),
      Effect.forkScoped({ startImmediately: true }),
    )
    return Service.of({ flush: Effect.asVoid(Fiber.await(initial)) })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Tool.node, Mcp.node, Bus.node, Permission.node],
})
