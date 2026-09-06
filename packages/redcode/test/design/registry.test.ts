import { describe, expect, test } from "bun:test"
import { idFor } from "@/design/registry"

describe("prototype identity", () => {
  test("the same directory in the same session keeps one id, so one open tab keeps working", () => {
    expect(idFor("ses_1", "/w/.redcode/designs/hero")).toBe(idFor("ses_1", "/w/.redcode/designs/hero"))
  })

  test("a different session or a different directory is a different prototype", () => {
    expect(idFor("ses_1", "/w/a")).not.toBe(idFor("ses_2", "/w/a"))
    expect(idFor("ses_1", "/w/a")).not.toBe(idFor("ses_1", "/w/b"))
  })

  test("two prototypes of one session, at real paths, are two prototypes", () => {
    const session = "ses_f8fd610c5ffeu74HsqcdyYsV2Q"
    const a = idFor(session, "/home/someone/work/project/.redcode/designs/1757000000000-settings")
    const b = idFor(session, "/home/someone/work/project/.redcode/designs/1757000000001-onboarding")
    expect(a).not.toBe(b)
    expect(a).not.toBe(
      idFor("ses_f8fd610c5ffeu74HsqcdyYsV2R", "/home/someone/work/project/.redcode/designs/1757000000000-settings"),
    )
  })

  test("the id is safe to put in a URL", () => {
    const id = idFor("ses_1", "/w/.redcode/designs/hero world")
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(encodeURIComponent(id)).toBe(id)
  })
})

import { Effect } from "effect"
import path from "path"
import { FSUtil } from "@reddb-io/redcode-core/fs-util"
import { LayerNode } from "@reddb-io/redcode-core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionStatus } from "@/session/status"
import { SessionID } from "@/session/schema"
import { DesignRegistry } from "@/design/registry"
import { DesignManifest } from "@/design/manifest"
import { Database } from "@reddb-io/redcode-core/database/database"
import { SessionProjector } from "@reddb-io/redcode-core/session/projector"
import { AppNodeBuilder } from "@reddb-io/redcode-core/effect/app-node-builder"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Session } from "@/session/session"
import { testEffect } from "../lib/effect"

// A real session service, so "deleted" is the durable event the product publishes, not a stand-in.
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      DesignRegistry.node,
      EventV2Bridge.node,
      FSUtil.node,
      Database.node,
      Session.node,
      SessionProjector.node,
    ]),
    [[RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })]],
  ),
)

const session = SessionID.make("ses_end")

const prototypeIn = (name: string, manifest?: string) =>
  Effect.gen(function* () {
    const ctx = yield* InstanceState.context
    const fs = yield* FSUtil.Service
    const root = path.join(ctx.directory, name)
    yield* fs.ensureDir(root)
    yield* Effect.promise(() => Bun.write(path.join(root, "index.html"), "<html></html>"))
    if (manifest !== undefined) yield* Effect.promise(() => Bun.write(DesignManifest.file(root), manifest))
    const registry = yield* DesignRegistry.Service
    return { root, registry, prototype: yield* registry.register({ sessionID: session, root, name }) }
  })

const idle = () =>
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    yield* events.publish(SessionStatus.Event.Status, { sessionID: session, status: { type: "idle" } })
  })

describe("when the session moves on", () => {
  it.instance("a turn's end is written into design.json once per revision", () =>
    Effect.gen(function* () {
      const { root, registry, prototype } = yield* prototypeIn(
        "hero",
        DesignManifest.serialize(DesignManifest.empty("hero")),
      )
      yield* idle()
      const first = DesignManifest.parse(yield* Effect.promise(() => Bun.file(DesignManifest.file(root)).text()), "x")
      expect(first.state?.revision).toBe(prototype.revision)
      const stamp = first.state?.updated

      // Idle again at the same revision: nothing is rewritten.
      yield* Effect.sleep("5 millis")
      yield* idle()
      const second = DesignManifest.parse(yield* Effect.promise(() => Bun.file(DesignManifest.file(root)).text()), "x")
      expect(second.state?.updated).toBe(stamp)

      // A revision later, it moves.
      const revised = yield* registry.register({ sessionID: session, root, name: "hero" })
      yield* idle()
      const third = DesignManifest.parse(yield* Effect.promise(() => Bun.file(DesignManifest.file(root)).text()), "x")
      expect(third.state?.revision).toBe(revised.revision)
    }),
  )

  it.instance("a manifest that cannot be read does not fail the turn, and a missing one is left missing", () =>
    Effect.gen(function* () {
      const { root } = yield* prototypeIn("broken", "{not json")
      yield* prototypeIn("none")
      yield* idle()
      // The broken one was rewritten as a fresh manifest with state; the missing one stays missing.
      expect(yield* Effect.promise(() => Bun.file(DesignManifest.file(root)).text())).toContain('"state"')
      const ctx = yield* InstanceState.context
      expect(yield* (yield* FSUtil.Service).existsSafe(DesignManifest.file(path.join(ctx.directory, "none")))).toBe(
        false,
      )
    }),
  )

  it.instance("deleting the session makes its prototypes unreachable, and leaves the others", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const ctx = yield* InstanceState.context
      const registry = yield* DesignRegistry.Service
      const doomed = yield* sessions.create({ title: "doomed" })
      const kept = yield* sessions.create({ title: "kept" })
      const gone = yield* registry.register({
        sessionID: doomed.id,
        root: path.join(ctx.directory, "gone"),
        name: "gone",
      })
      const stays = yield* registry.register({
        sessionID: kept.id,
        root: path.join(ctx.directory, "stays"),
        name: "stays",
      })

      yield* sessions.remove(doomed.id)
      expect(yield* registry.get(gone.id)).toBeUndefined()
      expect(yield* registry.get(stays.id)).toBeDefined()
    }),
  )

  it.instance("a surface that checks in is remembered, across revisions", () =>
    Effect.gen(function* () {
      const { root, registry, prototype } = yield* prototypeIn("seen")
      expect(prototype.lastSeen).toBeUndefined()
      yield* registry.touch(prototype.id)
      const seen = (yield* registry.get(prototype.id))!.lastSeen
      expect(typeof seen).toBe("number")
      const revised = yield* registry.register({ sessionID: session, root, name: "seen" })
      expect(revised.lastSeen).toBe(seen)
    }),
  )
})

import { Stream, Fiber, Deferred, Scope, Exit } from "effect"
import { DesignState } from "@/design/state"

/** The first `count` events of a subscription, collected in the background so the test can act. */
const collect = (id: string, count: number) =>
  Effect.gen(function* () {
    const registry = yield* DesignRegistry.Service
    const scope = yield* Scope.make()
    const stream = yield* registry.subscribe(id).pipe(Scope.provide(scope))
    const ready = yield* Deferred.make<void>()
    const fiber = yield* stream.pipe(
      Stream.tap(() => Deferred.succeed(ready, undefined)),
      Stream.take(count),
      Stream.runCollect,
      Effect.forkChild,
    )
    // The subscription is live once the fiber is running; give it a beat before acting.
    yield* Effect.sleep("20 millis")
    return {
      events: Effect.gen(function* () {
        const out = yield* Fiber.join(fiber)
        yield* Scope.close(scope, Exit.void)
        return [...out]
      }),
    }
  })

describe("what a review remembers, and tells a mounted shell", () => {
  it.instance("registering writes a sidecar and the index; a turn's reply and the person's words join the chat", () =>
    Effect.gen(function* () {
      const { root, registry, prototype } = yield* prototypeIn("kept")
      const fs = yield* FSUtil.Service
      const sidecar = DesignState.parse((yield* fs.readFileStringSafe(DesignState.file(root)))!)!
      expect(sidecar.token).toBe(prototype.token)
      expect(sidecar.revision).toBe(1)
      const index = DesignState.parseIndex((yield* fs.readFileStringSafe(DesignState.INDEX))!)
      expect(index[prototype.id]).toEqual({ root, sessionID: session })

      yield* registry.say(prototype.id, { role: "user", text: "make it blue" })
      const after = (yield* registry.get(prototype.id))!
      expect(after.chat.map((c) => c.text)).toEqual(["make it blue"])
      const persisted = DesignState.parse((yield* fs.readFileStringSafe(DesignState.file(root)))!)!
      expect(persisted.chat.map((c) => c.text)).toEqual(["make it blue"])
    }),
  )

  it.instance("a bump is a reload every listening shell hears; a change on disk is a bump while someone listens", () =>
    Effect.gen(function* () {
      const { root, registry, prototype } = yield* prototypeIn("live")
      const { events } = yield* collect(prototype.id, 2)
      yield* registry.bump(prototype.id)
      // The agent saved a file: noticed by the poll, settled, then one reload.
      yield* Effect.sleep("50 millis")
      yield* Effect.promise(() => Bun.write(path.join(root, "index.html"), "<html><body>v2</body></html>"))
      const got = yield* events.pipe(Effect.timeout("6 seconds"))
      expect(got.map((e) => e.type)).toEqual(["reload", "reload"])
      expect((got[1] as { revision: number }).revision).toBe(3)
      expect((yield* registry.get(prototype.id))!.revision).toBe(3)
    }),
  )

  it.instance("ending is remembered with who did it, is told to the shell, and is undone only on purpose", () =>
    Effect.gen(function* () {
      const { root, registry, prototype } = yield* prototypeIn("done")
      const { events } = yield* collect(prototype.id, 1)
      yield* registry.end(prototype.id, "user")
      expect((yield* events).map((e) => e.type)).toEqual(["ended"])
      expect((yield* registry.get(prototype.id))!.ended?.by).toBe("user")
      // Ending twice keeps the first author.
      yield* registry.end(prototype.id, "agent")
      expect((yield* registry.get(prototype.id))!.ended?.by).toBe("user")
      const fs = yield* FSUtil.Service
      expect(DesignState.parse((yield* fs.readFileStringSafe(DesignState.file(root)))!)!.ended?.by).toBe("user")
      // Re-registering keeps it ended; reopening clears it.
      expect((yield* registry.register({ sessionID: session, root, name: "done" })).ended?.by).toBe("user")
      yield* registry.reopen(prototype.id)
      expect((yield* registry.get(prototype.id))!.ended).toBeUndefined()
    }),
  )

  it.instance("the agent's reply enters the chat when the turn ends, and the shell hears presence", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const ctx = yield* InstanceState.context
      const registry = yield* DesignRegistry.Service
      const chat = yield* sessions.create({ title: "talk" })
      const root = path.join(ctx.directory, "talk")
      yield* (yield* FSUtil.Service).ensureDir(root)
      const prototype = yield* registry.register({ sessionID: chat.id, root, name: "talk" })
      const { events } = yield* collect(prototype.id, 3)
      const events2 = yield* EventV2Bridge.Service
      yield* events2.publish(SessionStatus.Event.Status, { sessionID: chat.id, status: { type: "busy" } })
      // What the assistant said this turn, as the session stores it.
      const { MessageID, PartID } = yield* Effect.promise(() => import("@/session/schema"))
      const msg = (yield* sessions.updateMessage({
        id: MessageID.ascending(),
        sessionID: chat.id,
        role: "assistant",
        parentID: MessageID.ascending(),
        mode: "design",
        agent: "design",
        cost: 0,
        path: { cwd: root, root },
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: "m",
        providerID: "p",
        time: { created: Date.now() },
      } as never)) as { id: string }
      yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: msg.id,
        sessionID: chat.id,
        type: "text",
        text: "I made the header blue.",
      } as never)
      yield* events2.publish(SessionStatus.Event.Status, { sessionID: chat.id, status: { type: "idle" } })
      const got = yield* events.pipe(Effect.timeout("5 seconds"))
      expect(got.map((e) => e.type)).toEqual(["presence", "presence", "agent-reply"])
      expect((got[0] as { state: string }).state).toBe("working")
      expect((got[2] as { text: string }).text).toBe("I made the header blue.")
      expect((yield* registry.get(prototype.id))!.chat.at(-1)?.role).toBe("agent")
    }),
  )
})

describe("loads", () => {
  it.instance("are named per shell; a begin that lost a race keeps the newer load, and a shell forgets its oldest", () =>
    Effect.gen(function* () {
      const { registry, prototype } = yield* prototypeIn("loads")

      const second = (yield* registry.beginLoad(prototype.id, { client: "tab", sequence: 2 }))!
      const late = (yield* registry.beginLoad(prototype.id, { client: "tab", sequence: 1 }))!
      expect(late.stale).toBe("out-of-order")
      expect(late.token).toBe(second.token)
      expect(yield* registry.verifyLoad(prototype.id, second.token)).toBe(true)
      expect(yield* registry.verifyLoad(prototype.id, "nope")).toBe(false)

      // Another shell does not disturb this one's load.
      const other = (yield* registry.beginLoad(prototype.id, { client: "phone", sequence: 1 }))!
      expect(yield* registry.verifyLoad(prototype.id, second.token)).toBe(true)
      expect(yield* registry.verifyLoad(prototype.id, other.token)).toBe(true)

      // A pass under a load that has since been replaced is stale.
      const third = (yield* registry.beginLoad(prototype.id, { client: "tab", sequence: 3 }))!
      const stale = (yield* registry.diagnostics(prototype.id, {
        artifact_load_token: second.token,
        artifact_revision: second.revision,
        artifact_pass_sequence: 1,
        viewport_width: 390,
        findings: [],
      }))!
      expect(stale.stale).toBe(true)
      const fresh = (yield* registry.diagnostics(prototype.id, {
        artifact_load_token: third.token,
        artifact_revision: third.revision,
        artifact_pass_sequence: 1,
        viewport_width: 390,
        findings: [{ selector: "html", kind: "page-horizontal-overflow", axis: "horizontal", overflowPx: 80, severity: "error" }],
      }))!
      expect(fresh.stale).toBe(false)
      expect(fresh.changed).toBe(true)
      expect(fresh.warnings[0]!.viewport_class).toBe("mobile")
    }),
  )
})
