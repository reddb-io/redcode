import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { SessionV1 } from "@reddb-io/redcode-core/v1/session"
import { SessionStatusEvent } from "@reddb-io/redcode-schema/session-status-event"
import { InstanceState } from "@/effect/instance-state"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Session } from "@/session/session"
import { Config } from "@/config/config"
import { Context, Effect, Fiber, Layer, PubSub, Semaphore, Stream } from "effect"
import { createHash, randomBytes } from "node:crypto"
import { promises as nodeFs } from "node:fs"
import path from "path"
import type { SessionID } from "@/session/schema"
import { DesignAttachments } from "./attachments"
import { DesignExport } from "./export"
import { DesignLayoutWarnings } from "./layout-warnings"
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
  /** Images handed to the agent, and when. */
  readonly delivered: readonly DesignState.Delivered[]
  /** The passive layout inbox: what the browser proved, and what the person did about it. */
  readonly warnings: readonly DesignLayoutWarnings.Warning[]
}

/**
 * One load of the prototype into one shell's frame. The token ties a diagnostic pass to the
 * document that ran it: a pass from a frame that has since been replaced is stale, and a stale
 * pass is discarded rather than allowed to clear or create a warning for a page nobody is seeing.
 */
export interface Load {
  readonly token: string
  readonly revision: number
  readonly sequence: number
  /** The highest pass this load has reported; a lower or equal one is a replay. */
  lastPass: number
  /** Failures already reported for this load, so a page that keeps failing wakes the agent once. */
  readonly failures: Set<string>
}

export type LoadBegun = { readonly revision: number; readonly token: string; readonly stale?: "out-of-order" }

/** What a review page was configured to do about layout. */
export interface Settings {
  readonly viewports: readonly DesignLayoutWarnings.ViewportClass[]
  readonly gate: boolean
  readonly gateTimeoutMs: number
  /** Host names the surface answers to beyond this machine's own. */
  readonly hosts: readonly string[]
}

export const GATE_TIMEOUT_MS = 12_000
export const GATE_TIMEOUT_MAX_MS = 60_000
/** Frames one prototype remembers loads for; a shell that keeps reloading forgets its oldest. */
export const MAX_LOADS = 8
export const MAX_FAILURES = 20
export const FAILURE_KINDS = ["artifact-unavailable", "artifact-asset-unavailable"] as const
export interface Failure {
  readonly kind: (typeof FAILURE_KINDS)[number]
  readonly detail: string
}

/** What a mounted shell is told as it happens. */
export type LiveEvent =
  | { readonly type: "reload"; readonly revision: number }
  | { readonly type: "agent-reply"; readonly text: string; readonly at: number }
  | { readonly type: "chat-sync"; readonly chat: readonly DesignState.ChatEntry[] }
  | { readonly type: "presence"; readonly state: "working" | "waiting" }
  | { readonly type: "ended"; readonly by: DesignState.EndedBy }
  | { readonly type: "layout-warnings"; readonly warnings: readonly DesignLayoutWarnings.Serialized[] }

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
  /** Images went to the agent with a send; they stay referenced for the delivery grace. */
  readonly deliver: (id: string, attachmentIDs: readonly string[]) => Effect.Effect<void>
  /** Every `<id>/<attachment>` the sweep must keep, across every review this machine knows. */
  readonly referenced: () => Effect.Effect<Set<string>>
  /** The attachment store's limits, from config. */
  readonly attachments: () => Effect.Effect<DesignAttachments.Config>
  /** One writer at a time in the attachment store: admission, write and sweep are one critical section. */
  readonly exclusive: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  /** The layout audit's settings, from config. */
  readonly settings: () => Effect.Effect<Settings>
  /** The export's size caps, from config. */
  readonly exportCaps: () => Effect.Effect<DesignExport.Options>
  /** A shell is about to load the frame: mint the token that ties that document's passes to it. */
  readonly beginLoad: (id: string, input: { client: string; sequence: number }) => Effect.Effect<LoadBegun | undefined>
  /** Is this the token of a load still current for this prototype? */
  readonly verifyLoad: (id: string, token: string) => Effect.Effect<boolean>
  /** Fold one browser pass into the inbox. Never wakes the agent; a stale pass changes nothing. */
  readonly diagnostics: (
    id: string,
    payload: Record<string, unknown>,
  ) => Effect.Effect<{ stale: boolean; changed: boolean; warnings: DesignLayoutWarnings.Serialized[] } | undefined>
  /** The person selected warnings to fix: the note they would send, without committing anything yet. */
  readonly prepareWarnings: (
    id: string,
    ids: readonly unknown[],
    revision: number | undefined,
  ) => Effect.Effect<
    | { conflict: true; revision: number }
    | {
        conflict?: undefined
        queued: DesignLayoutWarnings.Warning[]
        prompt: ReturnType<typeof DesignLayoutWarnings.promptPayload> | null
        warnings: DesignLayoutWarnings.Serialized[]
      }
    | undefined
  >
  /** The note with those warnings was delivered: they are now repair requests. */
  readonly commitWarnings: (id: string, ids: readonly unknown[]) => Effect.Effect<void>
  readonly dismissWarning: (
    id: string,
    warningID: unknown,
  ) => Effect.Effect<{ changed: boolean; warnings: DesignLayoutWarnings.Serialized[] } | undefined>
  /**
   * The prototype could not be shown: the document itself, or a local asset it declares. Deduped
   * per load; what comes back is only what is new, and the route wakes the agent with it.
   */
  readonly failures: (
    id: string,
    payload: Record<string, unknown>,
  ) => Effect.Effect<{ stale: boolean; fresh: Failure[] } | undefined>
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
    const config = yield* Config.Service
    const lock = yield* Semaphore.make(1)

    interface State {
      readonly data: Map<string, Prototype>
      readonly hubs: Map<string, PubSub.PubSub<LiveEvent>>
      readonly listeners: Map<string, number>
      readonly pollers: Map<string, Fiber.Fiber<void>>
      readonly baselines: Map<string, string>
      /** Per prototype, per shell (its own random id): the load whose passes are current. */
      readonly loads: Map<string, Map<string, Load>>
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
          ...(item.delivered.length ? { delivered: item.delivered } : {}),
          ...(item.warnings.length ? { warnings: item.warnings } : {}),
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
          delivered: parsed.delivered ?? [],
          warnings: parsed.warnings ?? [],
        }
        return item
      }).pipe(Effect.catchCause(() => Effect.succeed(undefined)))

    const attachments = Effect.fn("DesignRegistry.attachments")(function* () {
      return DesignAttachments.resolveConfig((yield* config.get()).experimental?.design?.attachments)
    })

    const settings = Effect.fn("DesignRegistry.settings")(function* () {
      const design = (yield* config.get()).experimental?.design
      const timeout = design?.gate_timeout
      return {
        viewports: DesignLayoutWarnings.resolveViewportClasses(design?.viewports),
        gate: design?.gate !== false,
        gateTimeoutMs:
          typeof timeout === "number" && timeout > 0 ? Math.min(timeout, GATE_TIMEOUT_MAX_MS) : GATE_TIMEOUT_MS,
        hosts: (design?.hosts ?? []).map(String),
      } satisfies Settings
    })

    const exportCaps = Effect.fn("DesignRegistry.exportCaps")(function* () {
      const caps = (yield* config.get()).experimental?.design?.export
      return {
        maxAssetBytes: caps?.max_asset_bytes ?? DesignExport.DEFAULT_MAX_ASSET_BYTES,
        maxBundleBytes: caps?.max_bundle_bytes ?? DesignExport.DEFAULT_MAX_BUNDLE_BYTES,
      } satisfies DesignExport.Options
    })

    /** Everything the index knows, with the sidecars' delivered lists: nothing referenced is swept. */
    const referenced = Effect.fn("DesignRegistry.referenced")(function* () {
      const out = new Set<string>()
      const now = Date.now()
      const raw = yield* fs.readFileStringSafe(DesignState.INDEX).pipe(Effect.orElseSucceed(() => undefined))
      const index = raw ? DesignState.parseIndex(raw) : {}
      for (const [id, entry] of Object.entries(index)) {
        const sidecar = yield* fs.readFileStringSafe(DesignState.file(entry.root)).pipe(Effect.orElseSucceed(() => undefined))
        const parsed = sidecar ? DesignState.parse(sidecar) : undefined
        for (const item of parsed?.delivered ?? []) {
          if (now - item.at <= DesignAttachments.DELIVERY_GRACE_MS) out.add(`${id}/${item.id}`)
        }
      }
      return out
    })

    const sweep = Effect.gen(function* () {
      const cfg = yield* attachments()
      const keep = yield* referenced()
      yield* lock.withPermits(1)(
        Effect.promise(() =>
          DesignAttachments.sweep(DesignAttachments.ROOT, {
            ttlMs: cfg.ttlMs,
            maxDiskBytes: cfg.maxDiskBytes,
            maxObjects: cfg.maxObjects,
            referenced: keep,
            evictionGraceMs: cfg.evictionGraceMs,
          }),
        ),
      )
    }).pipe(Effect.catchCause((cause) => Effect.logWarning("design: attachment sweep failed", { cause })))

    const state = yield* InstanceState.make(
      Effect.fn("DesignRegistry.state")(function* (ctx) {
        const st: State = {
          data: new Map(),
          hubs: new Map(),
          listeners: new Map(),
          pollers: new Map(),
          baselines: new Map(),
          loads: new Map(),
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
        // Expired and unreferenced images go at start and once an hour; nothing waits on it.
        const sweeper = yield* Effect.forkDetach(
          Effect.gen(function* () {
            while (true) {
              yield* sweep
              yield* Effect.sleep("1 hour")
            }
          }),
        )
        yield* Effect.addFinalizer(() => Fiber.interrupt(sweeper))
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
        delivered: existing?.delivered ?? [],
        warnings: existing?.warnings ?? [],
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
          // Let a burst of saves settle before the shell reloads once for all of them. Wider while
          // a batch of layout fixes is outstanding: the agent is touching several places for one
          // reload, and every extra reload is a pass that cannot yet resolve anything.
          const outstanding = item.warnings.some(DesignLayoutWarnings.hasOutstandingRepairRequest)
          yield* Effect.sleep(outstanding ? DesignWatch.BATCH_DEBOUNCE_MS : DesignWatch.DEBOUNCE_MS)
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

    const deliver = Effect.fn("DesignRegistry.deliver")(function* (id: string, attachmentIDs: readonly string[]) {
      if (attachmentIDs.length === 0) return
      const at = Date.now()
      yield* update(id, (item) => ({
        ...item,
        delivered: [...item.delivered, ...attachmentIDs.map((aid) => ({ id: aid, at }))].slice(-DesignState.MAX_DELIVERED),
      }))
    })

    const exclusive = <A, E, R>(effect: Effect.Effect<A, E, R>) => lock.withPermits(1)(effect)

    // --- the passive layout inbox ---------------------------------------------------------------

    const beginLoad = Effect.fn("DesignRegistry.beginLoad")(function* (
      id: string,
      input: { client: string; sequence: number },
    ) {
      const { st } = yield* InstanceState.get(state)
      const item = yield* lookup(id)
      if (!item) return undefined
      const byClient = st.loads.get(id) ?? new Map<string, Load>()
      st.loads.set(id, byClient)
      const client = String(input.client || "").slice(0, 64) || "anon"
      const sequence = Number.isSafeInteger(input.sequence) && input.sequence > 0 ? input.sequence : 0
      const existing = byClient.get(client)
      // A begin that arrives after a later one from the same shell lost a race; the later load
      // is the one showing, and it keeps its token.
      if (existing && sequence > 0 && existing.sequence > sequence) {
        return { revision: existing.revision, token: existing.token, stale: "out-of-order" as const }
      }
      const token = randomBytes(24).toString("base64url")
      byClient.delete(client)
      byClient.set(client, { token, revision: item.revision, sequence, lastPass: 0, failures: new Set() })
      while (byClient.size > MAX_LOADS) byClient.delete(byClient.keys().next().value!)
      return { revision: item.revision, token }
    })

    const findLoad = (st: State, id: string, token: unknown): Load | undefined => {
      const key = String(token || "")
      if (!key) return undefined
      for (const load of st.loads.get(id)?.values() ?? []) if (load.token === key) return load
      return undefined
    }

    const verifyLoad = Effect.fn("DesignRegistry.verifyLoad")(function* (id: string, token: string) {
      const { st } = yield* InstanceState.get(state)
      const item = yield* lookup(id)
      const load = findLoad(st, id, token)
      return !!item && !!load && load.revision === item.revision
    })

    const publishWarnings = (id: string, warnings: readonly DesignLayoutWarnings.Warning[]) =>
      Effect.gen(function* () {
        const { publish } = yield* InstanceState.get(state)
        yield* publish(id, { type: "layout-warnings", warnings: DesignLayoutWarnings.serializeAll(warnings) })
      })

    const diagnostics = Effect.fn("DesignRegistry.diagnostics")(function* (
      id: string,
      payload: Record<string, unknown>,
    ) {
      const { st } = yield* InstanceState.get(state)
      const item = yield* lookup(id)
      if (!item) return undefined
      const stale = { stale: true, changed: false, warnings: DesignLayoutWarnings.serializeAll(item.warnings) }
      const load = findLoad(st, id, payload.artifact_load_token)
      const revision = Number(payload.artifact_revision)
      const sequence = Number(payload.artifact_pass_sequence)
      if (
        !load ||
        !Number.isInteger(revision) ||
        revision !== load.revision ||
        !Number.isInteger(sequence) ||
        sequence <= load.lastPass
      )
        return stale
      load.lastPass = sequence
      const cfg = yield* settings()
      const at = new Date().toISOString()
      const viewportWidth = Number(payload.viewport_width) || 0
      // A class that is not audited is not evidence either way; its findings are not recorded
      // only to be marked obsolete a line later.
      const audited = cfg.viewports.includes(DesignLayoutWarnings.viewportClassFor(viewportWidth))
      const pass = audited
        ? DesignLayoutWarnings.applyDiagnosticPass(item.warnings, {
            complete: payload.complete !== false,
            targetPresenceComplete: payload.target_presence_complete === true,
            viewportWidth,
            findings: Array.isArray(payload.findings) ? payload.findings : [],
            revision: load.revision,
            at,
          })
        : { warnings: [...item.warnings], changed: false }
      const obsolete = DesignLayoutWarnings.markObsoleteViewports(pass.warnings, cfg.viewports, {
        at,
        revision: load.revision,
      })
      const changed = pass.changed || obsolete.changed
      if (!changed) return { stale: false, changed: false, warnings: DesignLayoutWarnings.serializeAll(item.warnings) }
      const next = yield* update(id, (current) => ({ ...current, warnings: obsolete.warnings }))
      const warnings = next?.warnings ?? obsolete.warnings
      yield* publishWarnings(id, warnings)
      return { stale: false, changed: true, warnings: DesignLayoutWarnings.serializeAll(warnings) }
    })

    const prepareWarnings = Effect.fn("DesignRegistry.prepareWarnings")(function* (
      id: string,
      ids: readonly unknown[],
      revision: number | undefined,
    ) {
      const item = yield* lookup(id)
      if (!item) return undefined
      // The person chose from a list drawn for one revision. If the prototype moved meanwhile,
      // their choice may no longer mean what they think: say so, and let the page redraw.
      if (revision !== undefined && revision !== item.revision) return { conflict: true as const, revision: item.revision }
      const result = DesignLayoutWarnings.queue(item.warnings, ids, { revision: item.revision })
      return {
        queued: result.queued,
        prompt: result.queued.length ? DesignLayoutWarnings.promptPayload(result.queued) : null,
        warnings: DesignLayoutWarnings.serializeAll(item.warnings),
      }
    })

    const commitWarnings = Effect.fn("DesignRegistry.commitWarnings")(function* (id: string, ids: readonly unknown[]) {
      if (ids.length === 0) return
      const item = yield* lookup(id)
      if (!item) return
      const result = DesignLayoutWarnings.queue(item.warnings, ids, { revision: item.revision })
      if (!result.changed) return
      const next = yield* update(id, (current) => ({ ...current, warnings: result.warnings }))
      yield* publishWarnings(id, next?.warnings ?? result.warnings)
    })

    const dismissWarning = Effect.fn("DesignRegistry.dismissWarning")(function* (id: string, warningID: unknown) {
      const item = yield* lookup(id)
      if (!item) return undefined
      const result = DesignLayoutWarnings.dismiss(item.warnings, warningID, { revision: item.revision })
      if (!result.changed) return { changed: false, warnings: DesignLayoutWarnings.serializeAll(item.warnings) }
      const next = yield* update(id, (current) => ({ ...current, warnings: result.warnings }))
      const warnings = next?.warnings ?? result.warnings
      yield* publishWarnings(id, warnings)
      return { changed: true, warnings: DesignLayoutWarnings.serializeAll(warnings) }
    })

    const failures = Effect.fn("DesignRegistry.failures")(function* (id: string, payload: Record<string, unknown>) {
      const { st } = yield* InstanceState.get(state)
      const item = yield* lookup(id)
      if (!item) return undefined
      const load = findLoad(st, id, payload.artifact_load_token)
      const revision = Number(payload.artifact_revision)
      if (!load || !Number.isInteger(revision) || revision !== load.revision) return { stale: true, fresh: [] }
      const raw = Array.isArray(payload.failures) ? payload.failures : []
      const fresh: Failure[] = []
      for (const entry of raw.slice(0, MAX_FAILURES)) {
        if (!entry || typeof entry !== "object") continue
        const kind = String((entry as Record<string, unknown>).kind || "")
        if (!(FAILURE_KINDS as readonly string[]).includes(kind)) continue
        const detail = String((entry as Record<string, unknown>).detail || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 300)
        const key = `${kind}|${detail}`
        if (load.failures.has(key)) continue
        load.failures.add(key)
        fresh.push({ kind: kind as Failure["kind"], detail })
      }
      return { stale: false, fresh }
    })

    return Service.of({
      register,
      get,
      forSession,
      touch,
      release,
      subscribe,
      bump,
      say,
      end,
      reopen,
      deliver,
      referenced,
      attachments,
      exclusive,
      settings,
      exportCaps,
      beginLoad,
      verifyLoad,
      diagnostics,
      prepareWarnings,
      commitWarnings,
      dismissWarning,
      failures,
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [EventV2Bridge.node, FSUtil.node, Session.node, Config.node],
})

export * as DesignRegistry from "./registry"
