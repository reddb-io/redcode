import { describe, expect, test } from "bun:test"
import { heldNotice, pendingLabel, pendingPreview } from "../../src/prompt/pending"

describe("pending prompts", () => {
  test("a held prompt is named until it is sent or discarded; queued and steered ones are not", () => {
    expect(heldNotice([])).toBeUndefined()
    expect(
      heldNotice([
        { delivery: "queue", stale: false, files: 0 },
        { delivery: "steer", stale: false, files: 0 },
      ]),
    ).toBeUndefined()
    expect(heldNotice([{ delivery: "queue", stale: true, files: 0 }])).toBe("1 held prompt · /pending")
    expect(
      heldNotice([
        { delivery: "queue", stale: true, files: 0 },
        { delivery: "queue", stale: true, files: 2 },
        { delivery: "queue", stale: false, files: 0 },
      ]),
    ).toBe("2 held prompts · /pending")
  })

  test("each row says what will happen to the prompt", () => {
    expect(pendingLabel({ delivery: "queue", stale: true, files: 0 })).toStartWith("held")
    expect(pendingLabel({ delivery: "queue", stale: false, files: 1 })).toBe(
      "queued: runs when the current turn ends · 1 file",
    )
    expect(pendingLabel({ delivery: "steer", stale: false, files: 0 })).toStartWith("steer")
  })

  test("a preview is the first line, cut to fit a row", () => {
    expect(pendingPreview("  fix the parser\nthen run the tests")).toBe("fix the parser")
    expect(pendingPreview("x".repeat(100), 10)).toBe("x".repeat(9) + "…")
    expect(pendingPreview("   ")).toBe("(no text)")
  })
})
