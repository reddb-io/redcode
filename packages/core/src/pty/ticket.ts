export * as PtyTicket from "./ticket.js"

import type { Workspace } from "@opencode/schema/workspace"
import { PtyTicket } from "@opencode/schema/pty-ticket"
import { PtyID } from "./schema.js"
import type { PersistentPty } from "@opencode/schema/persistent-pty"
import { Cache, Context, Duration, Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

const DEFAULT_TTL = Duration.seconds(60)
const CAPACITY = 10_000

export const ConnectToken = PtyTicket.ConnectToken

export type Scope = {
  readonly ptyID: PtyID
  readonly directory?: string
  readonly workspaceID?: Workspace.ID
  readonly launch?: PersistentPty.LaunchBinding
}

export interface Interface {
  issue(input: Scope): Effect.Effect<typeof ConnectToken.Type>
  consume(input: Scope & { readonly ticket: string }): Effect.Effect<boolean>
  take(input: Omit<Scope, "launch"> & { readonly ticket: string }): Effect.Effect<Scope | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PtyTicket") {}

function matches(record: Scope, input: Scope) {
  return (
    record.ptyID === input.ptyID && record.directory === input.directory && record.workspaceID === input.workspaceID
  )
}

// Tickets are inserted via Cache.set and removed atomically via invalidateWhen. The lookup is
// never invoked; it dies if it ever is, which would signal a misuse of the Service interface.
const noLookup = () => Effect.die(new Error("PtyTicket cache must be used via set/invalidateWhen, never get"))

// Visible for tests so the TTL can be shortened. Production uses `layer` with the default TTL.
export const make = (ttl: Duration.Input = DEFAULT_TTL) =>
  Effect.gen(function* () {
    const cache = yield* Cache.make<string, Scope>({ capacity: CAPACITY, lookup: noLookup, timeToLive: ttl })
    const scopes = new Map<string, Scope>()
    const expiresIn = Math.max(1, Math.round(Duration.toSeconds(Duration.fromInputUnsafe(ttl))))
    return Service.of({
      issue: Effect.fn("PtyTicket.issue")(function* (input) {
        const ticket = crypto.randomUUID()
        yield* Cache.set(cache, ticket, input)
        scopes.set(ticket, input)
        const timer = setTimeout(() => scopes.delete(ticket), Math.max(1, Duration.toMillis(Duration.fromInputUnsafe(ttl))))
        timer.unref?.()
        return { ticket, expires_in: expiresIn }
      }),
      take: Effect.fn("PtyTicket.take")(function* (input) {
        const accepted = yield* Cache.invalidateWhen(cache, input.ticket, (stored) => matches(stored, input))
        if (!accepted) return undefined
        const scope = scopes.get(input.ticket)
        scopes.delete(input.ticket)
        return scope
      }),
      consume: Effect.fn("PtyTicket.consume")((input) =>
        Effect.gen(function* () {
          const accepted = yield* Cache.invalidateWhen(cache, input.ticket, (stored) => matches(stored, input))
          if (!accepted) return false
          scopes.delete(input.ticket)
          return true
        }),
      ),
    })
  })

const layer = Layer.effect(Service, make())

export const node = makeGlobalNode({ service: Service, layer: layer, deps: [] })
