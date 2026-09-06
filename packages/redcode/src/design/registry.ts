import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { SessionStatusEvent } from "@reddb-io/redcode-schema/session-status-event"
import { InstanceState } from "@/effect/instance-state"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Session } from "@/session/session"
import { Context, Effect, Fiber, Layer, PubSub, Stream } from "effect"
import { createHash, randomBytes } from "node:crypto"
import { promises as nodeFs } from "node:fs"
import path from "path"
import type { SessionID } from "@/session/schema"
import { DesignManifest } from "./manifest"
import { DesignState } from "./state"
import { DesignWatch } from "./watch"

/**
 * Which directories are currently reachable as prototypes, and by whom.
 *
 * Nothing is servable because it exists on disk: a prototype becomes reachable only when the agent
 * registers it for a session, and stops being reachable when the session ends. That is what keeps
 * a route that serves model-written HTML from being a general file server pointed at the worktree.
 *
 * It is also where a review's life is kept: the conversation, who ended it, the revision a mounted
 * shell should be showing, and the live events that tell a shell any of that changed. All of it is
 * written to a sidecar beside the prototype, so a server restart does not orphan an open tab.
 */

export interface Prototype {
  readonly id: string
  readonly sessionID: SessionID
  /** Absolute, already resolved. Every request is checked against this. */
  readonly root: string
  /** What the person is looking at, for the transcript. */
  readonly name: string
  /** Bumped on every re-registration and on every change on disk, so the browser reloads. */
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
   * When a review surface last checked in. "Some shell is mounted", not "someone is looking":
   * background tabs throttle their timers to a minute or worse. Absent until the first check-in.
   */
  readonly lastSeen?: number
  /** Set when the review was ended, and by whom; a user-ended review is not reopened unasked. */
  readonly ended?: DesignState.Ended
  /** What was said, both ways, for the panel to show again after a reload. */
  readonly chat: readonly DesignState.ChatEntry[]
}

/** What a mounted shell is told as it happens. */
export type LiveEvent =
  | { readonly type: "reload"; readonly revision: number }
  | { readonly type: "agent-reply"; readonly text: string; readonly at: number }
  | { readonly type: "chat-sync"; readonly chat: readonly DesignState.ChatEntry[] }
  | { readonly type: "presence"; readonly state: "working" | "waiting" }
  | { readonly type: "ended"; readonly by: DesignState.EndedBy }

export interface Interface {
  readonly register: (input: { sessionID: SessionID; root: string; name: string }) => Effect.Effect<Prototype>
  readonly get: (id: string) => Effect.Effect<Prototype | undefined>
  readonly forSession: (sessionID: SessionID) => Effect.Effect<Prototype[]>
  /** A review surface checked in. */
  readonly touch: (id: string) => Effect.Effect<void>
  /** Called when a session ends: its prototypes stop being reachable. */
  readonly release: (sessionID: SessionID) => Effect.Effect<void>
  /**
   * The live events for one prototype, for as long as the scope is open. While at least one
   * subscriber is listening the directory is watched for changes; when the last one leaves, it is
   * not — nobody is looking, so nothing needs to be noticed.
   */
  readonly subscribe: (id: string) => Effect.Effect<Stream.Stream<LiveEvent>, never, import("effect").Scope.Scope>
  /** The prototype changed: a new revision, and every listening shell reloads. */
  readonly bump: (id: string) => Effect.Effect<Prototype | undefined>
  /** Something was said; the panel keeps it and shows it again after a reload. */
  readonly say: (id: string, entry: { role: "user" | "agent"; text: string }) => Effect.Effect<void>
  /** The review ended. Who ended it matters: the agent does not reopen what a person closed. */
  readonly end: (id: string, by: DesignState.EndedBy) => Effect.Effect<Prototype | undefined>
  /** Explicitly opened again, by someone who knows it was ended. */
  readonly reopen: (id: string) => Effect.Effect<Prototype | undefined>
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

/** Written whole, then renamed into place: a reader never sees half a file. */
const writeAtomic = (file: string, content: string) =>
  Effect.promise(async () => {
    await nodeFs.mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
    await nodeFs.writeFile(tmp, content, "utf8")
    await nodeFs.rename(tmp, file)
  })

/** The last thing the assistant said in a turn, as the panel would show it. */
const lastReply = (messages: readonly SessionV1.WithParts[]) => {
  const last = messages.findLast((item) => item.info.role === "assistant")
  if (!last) return ""
  return last.parts
    .flatMap((part) => (part.type === "text" && !("synthetic" in part && part.synthetic) ? [part.text] : []))
    .join("\n")
    .trim()
    .slice(0, 4000)
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const fs = yield* FSUtil.Service
    const sessions = yield* Session.Service

    interface State {
      readonly data: Map<string, Prototype>
      readonly hubs: Map<string, PubSub.PubSub<LiveEvent>>
      readonly listeners: Map<string, number>
      readonly pollers: Map<string, Fiber.Fiber<void>>
      readonly baselines: Map<string, string>
    }

    const persist = (item: Prototype) =>
      Effect.gen(function* () {
        const state: DesignState.Persisted = {
          id: item.id,
          sessionID: item.sessionID,
          root: item.root,
          name: item.name,
          token: item.token,
          revision: item.revision,
          ...(item.ended ? { ended: item.ended } : {}),
          chat: item.chat,
        }
        yield* writeAtomic(DesignState.file(item.root), DesignState.serialize(state))
        const raw = yield* fs.readFileStringSafe(DesignState.INDEX).pipe(Effect.orElseSucceed(() => undefined))
        const index = raw ? DesignState.parseIndex(raw) : {}
        index[item.id] = { root: item.root, sessionID: item.sessionID }
        yield* writeAtomic(DesignState.INDEX, JSON.stringify(index, null, 2) + "\n")
      }).pipe(
        Effect.catchCause((cause) => Effect.logWarning("design: could not persist the review", { id: item.id, cause })),
      )

    /** Gone for good: the index forgets these ids, so nothing restores them from a sidecar. */
    const forget = (ids: readonly string[]) =>
      Effect.gen(function* () {
        if (ids.length === 0) return
        const raw = yield* fs.readFileStringSafe(DesignState.INDEX).pipe(Effect.orElseSucceed(() => undefined))
        if (!raw) return
        const index = DesignState.parseIndex(raw)
        let changed = false
        for (const id of ids) if (id in index) (delete index[id], (changed = true))
        if (changed) yield* writeAtomic(DesignState.INDEX, JSON.stringify(index, null, 2) + "\n")
      }).pipe(Effect.catchCause((cause) => Effect.logWarning("design: could not update the review index", { cause })))

    /** A prototype the process has forgotten, or never knew: the sidecar says what it was. */
    const restore = (id: string) =>
      Effect.gen(function* () {
        const raw = yield* fs.readFileStringSafe(DesignState.INDEX).pipe(Effect.orElseSucceed(() => undefined))
        const entry = raw ? DesignState.parseIndex(raw)[id] : undefined
        if (!entry) return undefined
        const sidecar = yield* fs
          .readFileStringSafe(DesignState.file(entry.root))
          .pipe(Effect.orElseSucceed(() => undefined))
        const parsed = sidecar ? DesignState.parse(sidecar) : undefined
        if (!parsed || parsed.id !== id || parsed.root !== entry.root) return undefined
        const item: Prototype = {
          id: parsed.id,
          sessionID: parsed.sessionID as SessionID,
          root: parsed.root,
          name: parsed.name,
          revision: parsed.revision,
          token: parsed.token,
          ...(parsed.ended ? { ended: parsed.ended } : {}),
          chat: parsed.chat,
        }
        return item
      }).pipe(Effect.catchCause(() => Effect.succeed(undefined)))

    const state = yield* InstanceState.make(
      Effect.fn("DesignRegistry.state")(function* (ctx) {
        const st: State = {
          data: new Map(),
          hubs: new Map(),
          listeners: new Map(),
          pollers: new Map(),
          baselines: new Map(),
        }
        const hub = (id: string) =>
          Effect.gen(function* () {
            const existing = st.hubs.get(id)
            if (existing) return existing
            const created = yield* PubSub.unbounded<LiveEvent>()
            st.hubs.set(id, created)
            return created
          })
        const publish = (id: string, event: LiveEvent) =>
          hub(id).pipe(Effect.flatMap((h) => PubSub.publish(h, event)), Effect.asVoid)

        // The listener closes over the state and `ctx` and never reaches for ambient instance
        // state: it runs in the publisher's fiber, and a session can be deleted with no instance
        // at all. Nothing here may fail the publisher — a bad design.json is logged, not raised.
        const unsubscribe = yield* events.listen((event) => {
          if (event.location?.directory !== ctx.directory) return Effect.void
          if (event.type === SessionStatusEvent.Status.type) {
            const { sessionID, status } = event.data as { sessionID: SessionID; status: SessionStatusEvent.Info }
            const mine = [...st.data.values()].filter((item) => item.sessionID === sessionID)
            if (mine.length === 0) return Effect.void
            const presence = status.type === "idle" ? "waiting" : "working"
            const tellPresence = Effect.forEach(mine, (item) => publish(item.id, { type: "presence", state: presence }), {
              discard: true,
            })
            if (status.type !== "idle") return tellPresence
            // The turn ended: what the agent said goes into the panel, and design.json learns
            // which revision this turn saw. Each prototype on its own: one that cannot be written
            // must not stop the others.
            const reply = sessions.messages({ sessionID }).pipe(
              Effect.map(lastReply),
              Effect.orElseSucceed(() => ""),
            )
            return Effect.gen(function* () {
              yield* tellPresence
              const text = yield* reply
              for (const item of mine) {
                const current = st.data.get(item.id) ?? item
                if (text && current.chat.at(-1)?.text !== text) {
                  const entry = { role: "agent" as const, text, at: Date.now() }
                  const next = { ...current, chat: [...current.chat, entry].slice(-DesignState.MAX_CHAT) }
                  st.data.set(item.id, next)
                  yield* persist(next)
                  yield* publish(item.id, { type: "agent-reply", text, at: entry.at })
                }
                yield* recordTurnEnd(fs, current).pipe(
                  Effect.catchCause((cause) =>
                    Effect.logWarning("design: could not record the turn's end", { root: item.root, cause }),
                  ),
                )
              }
            })
          }
          if (event.type === SessionV1.Event.Deleted.type) {
            const { sessionID } = event.data as { sessionID: SessionID }
            const gone: string[] = []
            for (const [id, item] of st.data) if (item.sessionID === sessionID) (st.data.delete(id), gone.push(id))
            return forget(gone)
          }
          return Effect.void
        })
        yield* Effect.addFinalizer(() => unsubscribe)
        yield* Effect.addFinalizer(() =>
          Effect.forEach([...st.pollers.values()], (fiber) => Fiber.interrupt(fiber), { discard: true }),
        )
        return { st, hub, publish }
      }),
    )

    const lookup = (id: string) =>
      Effect.gen(function* () {
        const { st } = yield* InstanceState.get(state)
        const known = st.data.get(id)
        if (known) return known
        const restored = yield* restore(id)
        if (restored) st.data.set(id, restored)
        return restored
      })

    const update = (id: string, change: (item: Prototype) => Prototype) =>
      Effect.gen(function* () {
        const { st } = yield* InstanceState.get(state)
        const current = yield* lookup(id)
        if (!current) return undefined
        const next = change(current)
        st.data.set(id, next)
        yield* persist(next)
        return next
      })

    const register = Effect.fn("DesignRegistry.register")(function* (input: {
      sessionID: SessionID
      root: string
      name: string
    }) {
      const { st, publish } = yield* InstanceState.get(state)
      const id = idFor(input.sessionID, input.root)
      const existing = yield* lookup(id)
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
        ...(existing?.ended ? { ended: existing.ended } : {}),
        chat: existing?.chat ?? [],
      }
      st.data.set(id, next)
      yield* persist(next)
      // The agent said "look again": every shell reloads, and the watcher's baseline moves with
      // it so the same save is not noticed twice.
      st.baselines.set(id, yield* Effect.promise(() => DesignWatch.fingerprint(next.root)))
      yield* publish(id, { type: "reload", revision: next.revision })
      return next
    })

    const get = Effect.fn("DesignRegistry.get")(function* (id: string) {
      return yield* lookup(id)
    })

    const forSession = Effect.fn("DesignRegistry.forSession")(function* (sessionID: SessionID) {
      const { st } = yield* InstanceState.get(state)
      return [...st.data.values()].filter((item) => item.sessionID === sessionID)
    })

    const touch = Effect.fn("DesignRegistry.touch")(function* (id: string) {
      const { st } = yield* InstanceState.get(state)
      const item = st.data.get(id)
      if (item) st.data.set(id, { ...item, lastSeen: Date.now() })
    })

    const release = Effect.fn("DesignRegistry.release")(function* (sessionID: SessionID) {
      const { st } = yield* InstanceState.get(state)
      const gone: string[] = []
      for (const [id, item] of st.data) if (item.sessionID === sessionID) (st.data.delete(id), gone.push(id))
      yield* forget(gone)
    })

    const bump = Effect.fn("DesignRegistry.bump")(function* (id: string) {
      const { st, publish } = yield* InstanceState.get(state)
      const next = yield* update(id, (item) => ({ ...item, revision: item.revision + 1 }))
      if (!next) return undefined
      st.baselines.set(id, yield* Effect.promise(() => DesignWatch.fingerprint(next.root)))
      yield* publish(id, { type: "reload", revision: next.revision })
      return next
    })

    /** Looks at the directory every second while someone is listening; a change is a bump. */
    const poll = (id: string) =>
      Effect.gen(function* () {
        const { st } = yield* InstanceState.get(state)
        while (true) {
          yield* Effect.sleep(DesignWatch.POLL_MS)
          const item = st.data.get(id)
          if (!item || item.ended) continue
          const baseline = st.baselines.get(id)
          const now = yield* Effect.promise(() => DesignWatch.fingerprint(item.root))
          if (baseline === undefined) {
            st.baselines.set(id, now)
            continue
          }
          if (now === baseline) continue
          // Let a burst of saves settle before the shell reloads once for all of them.
          yield* Effect.sleep(DesignWatch.DEBOUNCE_MS)
          yield* bump(id)
        }
      }).pipe(Effect.catchCause(() => Effect.void))

    const subscribe = Effect.fn("DesignRegistry.subscribe")(function* (id: string) {
      const { st, hub } = yield* InstanceState.get(state)
      const h = yield* hub(id)
      const count = (st.listeners.get(id) ?? 0) + 1
      st.listeners.set(id, count)
      if (count === 1 && !st.pollers.has(id)) {
        const item = st.data.get(id)
        if (item) st.baselines.set(id, yield* Effect.promise(() => DesignWatch.fingerprint(item.root)))
        st.pollers.set(id, yield* Effect.forkDetach(poll(id)))
      }
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          const left = (st.listeners.get(id) ?? 1) - 1
          st.listeners.set(id, left)
          if (left > 0) return
          const fiber = st.pollers.get(id)
          st.pollers.delete(id)
          if (fiber) yield* Fiber.interrupt(fiber)
        }),
      )
      return Stream.fromPubSub(h)
    })

    const say = Effect.fn("DesignRegistry.say")(function* (id: string, entry: { role: "user" | "agent"; text: string }) {
      const { publish } = yield* InstanceState.get(state)
      const text = entry.text.trim().slice(0, 4000)
      if (!text) return
      const next = yield* update(id, (item) => ({
        ...item,
        chat: [...item.chat, { role: entry.role, text, at: Date.now() }].slice(-DesignState.MAX_CHAT),
      }))
      if (next) yield* publish(id, { type: "chat-sync", chat: next.chat })
    })

    const end = Effect.fn("DesignRegistry.end")(function* (id: string, by: DesignState.EndedBy) {
      const { publish } = yield* InstanceState.get(state)
      const next = yield* update(id, (item) => (item.ended ? item : { ...item, ended: { by, at: Date.now() } }))
      if (next) yield* publish(id, { type: "ended", by: next.ended?.by ?? by })
      return next
    })

    const reopen = Effect.fn("DesignRegistry.reopen")(function* (id: string) {
      return yield* update(id, (item) => {
        const { ended: _ended, ...rest } = item
        return rest
      })
    })

    return Service.of({ register, get, forSession, touch, release, subscribe, bump, say, end, reopen })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [EventV2Bridge.node, FSUtil.node, Session.node],
})

export * as DesignRegistry from "./registry"
