export * as McpPool from "./pool.js"

import { Context, Effect, Exit, Layer, Scope } from "effect"
import { createHash } from "node:crypto"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import type { Mcp } from "@opencode/schema/mcp"
import { Environment } from "../environment/index.js"
import { KeyedMutex } from "../effect/keyed-mutex.js"
import type { McpClient } from "./client.js"

type Holder = {
  name: string
  elicitation: McpClient.ElicitationHandler
  close?: (reason: string) => void
  expired?: () => void
  tools?: () => void
  prompts?: () => void
  resources?: () => void
}
type Slot = {
  scope: Scope.Closeable
  connection: McpClient.Connection
  holders: Set<Holder>
  calls: Map<string, Map<Holder, number>>
  closed?: string
}
type Input = {
  name: string
  config: Mcp.RemoteConfig
  directory: string
  environment: Environment.Interface
  elicitation: McpClient.ElicitationHandler
  clientInfo?: { name: string; version: string }
}

/** OAuth accounts, legacy roots and implicit authentication remain private. */
export function eligible(config: Mcp.ServerConfig) {
  return (
    config.type === "remote" &&
    config.pool === true &&
    config.oauth === false &&
    config.protocol === "2026-07-28" &&
    URL.canParse(config.url) &&
    !new URL(config.url).username &&
    !new URL(config.url).password
  )
}

export class Service extends Context.Service<
  Service,
  {
    acquire(input: Input): Effect.Effect<McpClient.Connection, Error, Scope.Scope>
    stats(): { connections: number; holders: number }
  }
>()("@redcode/McpPool") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const root = yield* Effect.scope
    const slots = new Map<string, Slot>()
    const locks = KeyedMutex.makeUnsafe<string>()
    const acquire = (input: Input) => {
      // Hash the connection settings because URLs may contain credentials in their query string.
      const key = createHash("sha256")
        .update(
          JSON.stringify([
            input.name,
            input.config.url,
            input.config.codemode,
            input.config.timeout,
            input.clientInfo,
            Object.entries(input.config.headers ?? {}).toSorted(([a], [b]) => a.localeCompare(b)),
          ]),
        )
        .digest("hex")
      const holder: Holder = { name: input.name, elicitation: input.elicitation }
      const get = Effect.gen(function* () {
        let slot = slots.get(key)
        if (!slot) {
          const scope = yield* Scope.fork(root)
          const holders = new Set<Holder>()
          const calls = new Map<string, Map<Holder, number>>()
          const dispatcher: McpClient.ElicitationHandler = {
            create: (request) => {
              const targets = request.sessionID ? calls.get(request.sessionID) : undefined
              const active = targets ? [...targets.keys()].filter((target) => holders.has(target)) : []
              // Unsolicited or ambiguous requests cannot be attributed to a project safely.
              if (active.length !== 1) return Effect.succeed({ action: "cancel" as const })
              return active[0]!.elicitation.create({ ...request, server: active[0]!.name })
            },
            complete: () => Effect.void,
          }
          const { McpClient } = yield* Effect.promise(() => import("./client.js"))
          const connection = yield* McpClient.connect(
            input.name,
            input.config,
            input.directory,
            undefined,
            dispatcher,
            input.clientInfo,
            true,
          ).pipe(
            Effect.provideService(Environment.Service, input.environment),
            Scope.provide(scope),
            Effect.onError(() => Scope.close(scope, Exit.void)),
          )
          if (!connection.modern) {
            yield* Scope.close(scope, Exit.void)
            return yield* Effect.fail(new Error("The MCP server did not negotiate the required modern protocol"))
          }
          slot = { scope, connection, holders, calls }
          const current = slot
          slots.set(key, current)
          connection.onClose((reason) => {
            current.closed = reason
            if (slots.get(key) === current) slots.delete(key)
            for (const target of current.holders) target.close?.(reason)
          })
          connection.onSessionExpired(() => {
            for (const target of current.holders) target.expired?.()
          })
          connection.onToolsChanged(() => {
            for (const target of current.holders) target.tools?.()
          })
          connection.onPromptsChanged(() => {
            for (const target of current.holders) target.prompts?.()
          })
          connection.onResourcesChanged(() => {
            for (const target of current.holders) target.resources?.()
          })
        }
        slot.holders.add(holder)
        return slot
      }).pipe(locks.withLock(key))
      return Effect.acquireRelease(get, (slot) =>
        Effect.gen(function* () {
          slot.holders.delete(holder)
          if (slot.holders.size > 0) return
          if (slots.get(key) === slot) slots.delete(key)
          yield* Scope.close(slot.scope, Exit.void)
        }).pipe(locks.withLock(key)),
      ).pipe(
        Effect.map(
          (slot): McpClient.Connection => ({
            ...slot.connection,
            callTool: (call) =>
              Effect.acquireUseRelease(
                Effect.sync(() => {
                  if (!call.sessionID) return
                  const active = slot.calls.get(call.sessionID) ?? new Map<Holder, number>()
                  active.set(holder, (active.get(holder) ?? 0) + 1)
                  slot.calls.set(call.sessionID, active)
                }),
                () => slot.connection.callTool(call),
                () =>
                  Effect.sync(() => {
                    if (!call.sessionID) return
                    const active = slot.calls.get(call.sessionID)
                    if (!active) return
                    const count = (active.get(holder) ?? 0) - 1
                    if (count > 0) active.set(holder, count)
                    else active.delete(holder)
                    if (!active.size) slot.calls.delete(call.sessionID)
                  }),
              ),
            onClose: (callback) => {
              holder.close = callback
              if (slot.closed) callback(slot.closed)
            },
            onSessionExpired: (callback) => {
              holder.expired = callback
            },
            onToolsChanged: (callback) => {
              holder.tools = callback
            },
            onPromptsChanged: (callback) => {
              holder.prompts = callback
            },
            onResourcesChanged: (callback) => {
              holder.resources = callback
            },
          }),
        ),
      )
    }
    return Service.of({
      acquire,
      stats: () => ({
        connections: slots.size,
        holders: [...slots.values()].reduce((sum, slot) => sum + slot.holders.size, 0),
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
