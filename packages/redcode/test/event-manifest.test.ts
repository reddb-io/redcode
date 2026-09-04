import { describe, expect, test } from "bun:test"
import { SessionEvent } from "@reddb-io/redcode-core/session/event"
import { EventManifest as SchemaEventManifest } from "@reddb-io/redcode-schema/event-manifest"
import { Todo } from "@/session/todo"
import { EventManifest } from "@/event-manifest"

describe("public event manifest", () => {
  test("contains every latest public wire type once", () => {
    expect(EventManifest.Definitions).toBe(SchemaEventManifest.Definitions)
    expect(EventManifest.Latest).toBe(SchemaEventManifest.Latest)
    expect(EventManifest.Durable).toBe(SchemaEventManifest.Durable)
    expect(EventManifest.Latest.size).toBe(89)
    expect(EventManifest.Latest.get("session.next.step.ended")).toBe(SessionEvent.Step.Ended)
    expect(EventManifest.Latest.get("todo.updated")).toBe(Todo.Event.Updated)
    expect(EventManifest.Latest.has("ide.installed")).toBe(false)
    expect(EventManifest.Latest.has("server.connected")).toBe(true)
    expect(EventManifest.Latest.has("global.disposed")).toBe(true)
    // Live, and public on purpose: a client that wants to show why a turn was cut short reads it
    // from the wire rather than from the server's log.
    expect(EventManifest.Latest.get("session.next.guard.tripped")).toBe(SessionEvent.Guard.Tripped)
    expect(EventManifest.Durable.has("session.next.guard.tripped")).toBe(false)
  })

  test("contains only the current step settlement versions", () => {
    expect(EventManifest.Durable.has("session.next.step.ended.1")).toBe(false)
    expect(EventManifest.Durable.get("session.next.step.ended.2")).toBe(SessionEvent.Step.Ended)
  })
})
