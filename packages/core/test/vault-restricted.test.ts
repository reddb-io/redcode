import { describe, expect, test } from "bun:test"
import { Message } from "@opencode/ai"
import { DateTime } from "effect"
import { SessionCompaction } from "../src/session/compaction.js"
import { SessionMessage } from "../src/session/message.js"
import { VaultRestricted } from "../src/vault/restricted.js"

// Prose a user might write; nothing here is a real credential.
const prose = "a senha do servidor é " + "banana" + "123"

const user = (text: string) =>
  SessionMessage.User.make({
    id: SessionMessage.ID.create(),
    type: "user",
    text,
    time: { created: DateTime.makeUnsafe(0) },
  })

describe("VaultRestricted", () => {
  test("marks a message once, and never downgrades a withheld one", () => {
    const flagged = VaultRestricted.mark({ budget: { tokens: 10 } }, "msg_a", "sensitive")
    expect(flagged).toEqual({ budget: { tokens: 10 }, restricted: { msg_a: "sensitive" } })
    expect(VaultRestricted.mark(flagged, "msg_a", "sensitive")).toBeUndefined()
    const withheld = VaultRestricted.mark(flagged, "msg_a", "withheld")
    expect(withheld).toEqual({ budget: { tokens: 10 }, restricted: { msg_a: "withheld" } })
    expect(VaultRestricted.mark(withheld, "msg_a", "sensitive")).toBeUndefined()
    expect(VaultRestricted.withheld(withheld)).toEqual(new Set(["msg_a"]))
    expect(VaultRestricted.withheld(flagged)).toEqual(new Set())
    expect(VaultRestricted.excluded(flagged)).toEqual(new Set(["msg_a"]))
  })

  test("reads an unreadable marker as none", () => {
    expect(VaultRestricted.read({ restricted: { msg_a: "maybe" } })).toEqual({})
    expect(VaultRestricted.read(undefined)).toEqual({})
    expect(VaultRestricted.read({ restricted: "withheld" })).toEqual({})
    expect(VaultRestricted.withheld(undefined)).toEqual(new Set())
    expect(VaultRestricted.excluded(undefined)).toEqual(new Set())
  })

  test("marks a message on a Session without metadata and keeps other markers", () => {
    expect(VaultRestricted.mark(undefined, "msg_a", "withheld")).toEqual({ restricted: { msg_a: "withheld" } })
    const both = VaultRestricted.mark({ restricted: { msg_a: "withheld" } }, "msg_b", "sensitive")
    expect(both).toEqual({ restricted: { msg_a: "withheld", msg_b: "sensitive" } })
    expect(VaultRestricted.withheld(both)).toEqual(new Set(["msg_a"]))
    expect(VaultRestricted.excluded(both)).toEqual(new Set(["msg_a", "msg_b"]))
  })

  test("replaces only marked user messages and drops their attachments", () => {
    const marked = SessionMessage.User.make({
      id: SessionMessage.ID.create(),
      type: "user",
      text: prose,
      files: [{ data: Buffer.from(prose).toString("base64"), mime: "text/plain", source: { type: "inline" } }],
      agents: [{ name: "build" }],
      time: { created: DateTime.makeUnsafe(0) },
    })
    const kept = user("keep this")
    const messages = [marked, kept]
    expect(VaultRestricted.withholdMessages(messages, new Set())).toBe(messages)
    const [withheld, other] = VaultRestricted.withholdMessages(messages, new Set([marked.id]))
    expect(withheld).toMatchObject({ type: "user", text: VaultRestricted.WITHHELD })
    expect(withheld?.type === "user" ? [withheld.files, withheld.agents, withheld.skills] : []).toEqual([
      undefined,
      undefined,
      undefined,
    ])
    expect(other).toBe(kept)
    expect(JSON.stringify(VaultRestricted.withholdMessages(messages, new Set([marked.id])))).not.toContain("banana")
  })

  test("sends every message unchanged when none is withheld, and keeps messages without an ID", () => {
    const anonymous = Message.user(prose)
    const messages = [anonymous]
    const sent = VaultRestricted.withholdRequest(messages, new Set())
    expect(sent).toEqual(messages)
    expect(sent).not.toBe(messages)
    expect(VaultRestricted.withholdRequest(messages, new Set(["msg_other"]))[0]).toBe(anonymous)
  })

  test("keeps a flagged message's words out of the checkpoint anchors", () => {
    const flagged = user(prose)
    const kept = user("Fix ./src/main.ts for #42")
    const anchors = SessionCompaction.buildAnchors(
      VaultRestricted.withholdMessages([flagged, kept], new Set([flagged.id])),
    )
    expect(anchors).not.toContain("banana")
    expect(anchors).toContain(VaultRestricted.WITHHELD)
    expect(anchors).toContain("Fix ./src/main.ts for #42")
  })

  test("replaces only the withheld user message in a provider request", () => {
    const withheld = Message.make({ id: "msg_withheld", role: "user", content: prose })
    const other = Message.make({ id: "msg_other", role: "user", content: "keep this" })
    const reply = Message.make({ id: "msg_withheld", role: "assistant", content: "noted" })
    const sent = VaultRestricted.withholdRequest([withheld, other, reply], new Set(["msg_withheld"]))
    expect(JSON.stringify(sent)).not.toContain("banana")
    expect(sent[0]?.content).toEqual([{ type: "text", text: VaultRestricted.WITHHELD }])
    expect(sent[1]).toBe(other)
    expect(sent[2]).toBe(reply)
  })
})
