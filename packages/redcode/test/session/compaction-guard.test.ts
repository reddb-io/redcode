import { describe, expect, test } from "bun:test"
import { CompactionGuard } from "../../src/session/compaction-guard"

const at = 1_000

describe("CompactionGuard.afterAutomatic", () => {
  test("an effective compaction clears the count", () => {
    expect(
      CompactionGuard.afterAutomatic(
        { ineffective: 1, turn: "msg_b" },
        { effective: true, latestRequestID: "msg_a", turnID: "msg_b", now: at },
      ),
    ).toEqual({ ineffective: 0 })
  })

  test("two ineffective compactions in one turn pause until a newer request", () => {
    const first = CompactionGuard.afterAutomatic(
      { ineffective: 0 },
      { effective: false, latestRequestID: "msg_a", turnID: "msg_a", now: at },
    )
    expect(first).toEqual({ ineffective: 1, turn: "msg_a" })
    const second = CompactionGuard.afterAutomatic(first, {
      effective: false,
      latestRequestID: "msg_a",
      turnID: "msg_a",
      now: at,
    })
    expect(second.paused).toEqual({ after: "msg_a", at })
    expect(CompactionGuard.isPaused(second, "msg_a")).toBe(true)
    expect(CompactionGuard.isPaused(second, "msg_b")).toBe(false)
  })

  test("ineffective compactions in different turns do not add up", () => {
    const first = CompactionGuard.afterAutomatic(
      { ineffective: 0 },
      { effective: false, latestRequestID: "msg_a", turnID: "msg_a", now: at },
    )
    const later = CompactionGuard.afterAutomatic(first, {
      effective: false,
      latestRequestID: "msg_a",
      turnID: "msg_c",
      now: at,
    })
    expect(later).toEqual({ ineffective: 1, turn: "msg_c" })
  })

  test("the pause survives a round trip through session metadata", () => {
    const state = { ineffective: 2, turn: "msg_a", paused: { after: "msg_a", at } }
    const metadata = CompactionGuard.toMetadata({ other: true }, state)
    expect(metadata.other).toBe(true)
    expect(CompactionGuard.fromMetadata(metadata)).toEqual(state)
    expect(CompactionGuard.toMetadata(metadata, { ineffective: 0 })).toEqual({ other: true })
  })
})
