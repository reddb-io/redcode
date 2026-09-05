import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { SessionStatusEvent } from "@reddb-io/redcode-schema/session-status-event"
import { InstanceState } from "@/effect/instance-state"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Context, Effect, Layer } from "effect"
import { createHash, randomBytes } from "node:crypto"
import type { SessionID } from "@/session/schema"
import { DesignManifest } from "./manifest"

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
  /**
   * When a review surface last asked for the revision. "Some shell is mounted", not "someone is
   * looking": background tabs throttle their timers to a minute or worse, and the app's Design
   * tab polls too. Absent until the first poll.
   */
  readonly lastSeen?: number
}

export interface Interface {
  readonly register: (input: { sessionID: SessionID; root: string; name: string }) => Effect.Effect<Prototype>
  readonly get: (id: string) => Effect.Effect<Prototype | undefined>
  readonly forSession: (sessionID: SessionID) => Effect.Effect<Prototype[]>
  /** A review surface checked in. */
  readonly touch: (id: string) => Effect.Effect<void>
  /** Called when a session ends: its prototypes stop being reachable. */
  readonly release: (sessionID: SessionID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@redcode/DesignRegistry") {}

/**
 * Stable for a given directory within a session, so re-running the tool keeps one URL.
 *
 * Hashed, not encoded: a session id and a worktree path share a long prefix, and the first
 * version of this took the first 22 characters of a base64 encoding — which is the first
 * sixteen bytes of the input, the same for every prototype on the machine.
 */
export function idFor(sessionID: string, root: string) {
  return createHash("sha256").update(`${sessionID}:${root}`).digest("base64url").slice(0, 22)
}

/**
 * Where the session left the design: written into `design.json` when a turn ends, so a design
 * reopened later knows which revision it last saw. Skipped when nothing changed — idle is
 * published more than once per turn, and a rewrite per turn is git noise.
 */
const recordTurnEnd = (fs: FSUtil.Interface, prototype: Prototype) =>
  Effect.gen(function* () {
    const file = DesignManifest.file(prototype.root)
    // No manifest, or one that cannot be read: nothing to record. The design directory may be
    // gone by now, and that is not this listener's business.
    const raw = yield* fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))
    if (raw === undefined) return
    const manifest = DesignManifest.parse(raw, prototype.name)
    if (manifest.state?.revision === prototype.revision) return
    const next = { ...manifest, state: { revision: prototype.revision, updated: Date.now() } }
    yield* Effect.promise(() => Bun.write(file, DesignManifest.serialize(next)))
  })

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const fs = yield* FSUtil.Service

    const state = yield* InstanceState.make(
      Effect.fn("DesignRegistry.state")(function* (ctx) {
        const data = new Map<string, Prototype>()

        // The listener closes over `data` and `ctx` and never reaches for ambient instance state:
        // it runs in the publisher's fiber, and a session can be deleted with no instance at all.
        // Nothing here may fail the publisher — a bad design.json is logged, not raised.
        const unsubscribe = yield* events.listen((event) => {
          if (event.location?.directory !== ctx.directory) return Effect.void
          if (event.type === SessionStatusEvent.Status.type) {
            const { sessionID, status } = event.data as { sessionID: SessionID; status: SessionStatusEvent.Info }
            if (status.type !== "idle") return Effect.void
            const mine = [...data.values()].filter((item) => item.sessionID === sessionID)
            // Each prototype on its own: one that cannot be written must not stop the others.
            return Effect.forEach(
              mine,
              (item) =>
                recordTurnEnd(fs, item).pipe(
                  Effect.catchCause((cause) =>
                    Effect.logWarning("design: could not record the turn's end", { root: item.root, cause }),
                  ),
                ),
              { discard: true },
            )
          }
          if (event.type === SessionV1.Event.Deleted.type) {
            const { sessionID } = event.data as { sessionID: SessionID }
            for (const [id, item] of data) if (item.sessionID === sessionID) data.delete(id)
          }
          return Effect.void
        })
        yield* Effect.addFinalizer(() => unsubscribe)
        return data
      }),
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
        // Carried forward: a revision must not make a mounted surface look like it never checked in.
        ...(existing?.lastSeen !== undefined ? { lastSeen: existing.lastSeen } : {}),
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

    const touch = Effect.fn("DesignRegistry.touch")(function* (id: string) {
      const data = yield* InstanceState.get(state)
      const item = data.get(id)
      if (item) data.set(id, { ...item, lastSeen: Date.now() })
    })

    const release = Effect.fn("DesignRegistry.release")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      for (const [id, item] of data) if (item.sessionID === sessionID) data.delete(id)
    })

    return Service.of({ register, get, forSession, touch, release })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [EventV2Bridge.node, FSUtil.node] })

export * as DesignRegistry from "./registry"
