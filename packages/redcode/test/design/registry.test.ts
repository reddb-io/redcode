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
