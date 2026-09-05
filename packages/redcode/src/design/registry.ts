import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { Context, Effect, Layer } from "effect"
import { randomBytes } from "node:crypto"
import type { SessionID } from "@/session/schema"

/**
 * Which directories are currently reachable as prototypes, and by whom.
 *
 * Nothing is servable because it exists on disk: a prototype becomes reachable only when the agent
 * registers it for a session, and stops being reachable when the session ends. That is what keeps
 * a route that serves model-written HTML from being a general file server pointed at the worktree.
 */

export interface Prototype {
  readonly id: string
  readonly sessionID: SessionID
  /** Absolute, already resolved. Every request is checked against this. */
  readonly root: string
  /** What the person is looking at, for the transcript. */
  readonly name: string
  /** Bumped on every re-registration, so the browser can tell it is looking at stale bytes. */
  readonly revision: number
  /**
   * Binds a review surface to one prototype of one session.
   *
   * Not authentication: with no server password configured, anything on this machine can already
   * reach the API. What it buys is that a stray page cannot post feedback into a session it was
   * never opened for, and that revoking is possible.
   */
  readonly token: string
}

export interface Interface {
  readonly register: (input: { sessionID: SessionID; root: string; name: string }) => Effect.Effect<Prototype>
  readonly get: (id: string) => Effect.Effect<Prototype | undefined>
  readonly forSession: (sessionID: SessionID) => Effect.Effect<Prototype[]>
  /** Called when a session ends: its prototypes stop being reachable. */
  readonly release: (sessionID: SessionID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/DesignRegistry") {}

/** Stable for a given directory within a session, so re-running the tool keeps one URL. */
export function idFor(sessionID: string, root: string) {
  return Buffer.from(`${sessionID}:${root}`).toString("base64url").slice(0, 22)
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make(
      Effect.fn("DesignRegistry.state")(() => Effect.succeed(new Map<string, Prototype>())),
    )

    const register = Effect.fn("DesignRegistry.register")(function* (input: {
      sessionID: SessionID
      root: string
      name: string
    }) {
      const data = yield* InstanceState.get(state)
      const id = idFor(input.sessionID, input.root)
      const existing = data.get(id)
      // Re-registering the same directory keeps the token, so a browser tab already open on it does
      // not have to be reopened every time the agent revises the prototype.
      const next: Prototype = {
        id,
        sessionID: input.sessionID,
        root: input.root,
        name: input.name,
        revision: (existing?.revision ?? 0) + 1,
        token: existing?.token ?? randomBytes(32).toString("base64url"),
      }
      data.set(id, next)
      return next
    })

    const get = Effect.fn("DesignRegistry.get")(function* (id: string) {
      return (yield* InstanceState.get(state)).get(id)
    })

    const forSession = Effect.fn("DesignRegistry.forSession")(function* (sessionID: SessionID) {
      return [...(yield* InstanceState.get(state)).values()].filter((item) => item.sessionID === sessionID)
    })

    const release = Effect.fn("DesignRegistry.release")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      for (const [id, item] of data) if (item.sessionID === sessionID) data.delete(id)
    })

    return Service.of({ register, get, forSession, release })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [] })

export * as DesignRegistry from "./registry"
