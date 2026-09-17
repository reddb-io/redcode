import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { FileSystem } from "../src/filesystem"
import { DateTimeUtcFromMillis, RelativePath, optional } from "../src/schema"
import { SessionEvent } from "../src/session-event"
import { SessionID } from "../src/session-id"
import { SessionMessage } from "../src/session-message"

describe("schema compatibility", () => {
  test("moved class schemas remain constructible", () => {
    const input = new FileSystem.FindInput({ query: "src" })
    expect(input).toBeInstanceOf(FileSystem.FindInput)
    expect(input.query).toBe("src")
  })
})

describe("session.next.step.ended timing", () => {
  // The event's fields before `timing` existed, as a reader built from that schema decodes them.
  const before = Schema.Struct({
    timestamp: DateTimeUtcFromMillis,
    sessionID: SessionID,
    assistantMessageID: SessionMessage.ID,
    finish: Schema.String,
    cost: Schema.Finite,
    tokens: Schema.Struct({
      input: Schema.Finite,
      output: Schema.Finite,
      reasoning: Schema.Finite,
      cache: Schema.Struct({ read: Schema.Finite, write: Schema.Finite }),
    }),
    snapshot: Schema.String.pipe(optional),
    files: Schema.Array(RelativePath).pipe(optional),
  })
  const stored = {
    timestamp: 1_789_600_000_000,
    sessionID: "ses_0000000000000000000000000000000000000000000000000000000000000001",
    assistantMessageID: "msg_timing",
    finish: "stop",
    cost: 0,
    tokens: { input: 10, output: 120, reasoning: 0, cache: { read: 0, write: 0 } },
  }
  const timing = {
    requestStarted: 1_789_599_999_000,
    firstToken: 1_789_599_999_400,
    ttftMs: 400,
    genMs: 600,
    outputTokens: 120,
  }

  test("an event recorded with timing still decodes with the schema from before it", () => {
    const decoded = Schema.decodeUnknownSync(before)({ ...stored, timing })
    expect(decoded.finish).toBe("stop")
    expect("timing" in decoded).toBe(false)
  })

  test("an event recorded before timing decodes with the current schema, and a new one keeps it", () => {
    const current = SessionEvent.Step.Ended.data
    expect(Schema.decodeUnknownSync(current)(stored).timing).toBeUndefined()
    expect(Schema.decodeUnknownSync(current)({ ...stored, timing }).timing).toEqual(timing)
    expect(Schema.encodeSync(current)(Schema.decodeUnknownSync(current)(stored))).not.toHaveProperty("timing")
  })
})
