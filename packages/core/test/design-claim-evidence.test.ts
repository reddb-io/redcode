import { describe, expect, test } from "bun:test"
import { Design } from "@opencode/schema/design"
import { SessionMessage } from "@opencode/schema/session-message"
import { DesignRounds } from "@opencode/core/design/rounds"
import { DesignStore } from "@opencode/core/design/store"
import { IntelligenceEvaluation } from "@opencode/core/intelligence/evaluation"

const review: Design.Feedback = {
  id: SessionMessage.ID.make("msg_claim_review"),
  revision: "rev_1",
  text: "",
  items: [{ target: "#title", text: "Make the title larger", label: "h1", width: 390 }],
  assets: [],
  snapshot: "",
  delivery: "steer",
  end: false,
}

// Quotes and line breaks are the text that grows most once the evidence is serialized and clipped.
const heavy = (length: number) => '"\n'.repeat(length).slice(0, length)

const delta: Design.VerifyDelta = {
  changed: true,
  pixels: 37.5,
  text: true,
  markup: false,
  moved: true,
  resized: false,
  textBefore: heavy(240),
  textAfter: heavy(240),
}

const job: Design.Job = {
  id: "render_claim_verify",
  designID: Design.ID.make("design_claim"),
  input: { revision: "rev_2", format: "verify", round: 1 },
  status: "completed",
  progress: 1,
  result: null,
  error: null,
  created: 1,
  verify: {
    revision: "rev_2",
    round: 1,
    width: 390,
    notes: [
      {
        feedback: review.id,
        index: 1,
        label: "h1",
        found: true,
        blocking: false,
        findings: [],
        scenarios: [],
        reason: "found",
        width: 390,
        delta,
      },
    ],
    findings: [],
  },
}

describe("DesignRounds.claim change evidence", () => {
  test("keeps the delta flags when a long summary and element text are clipped for System One", () => {
    const admitted = DesignRounds.admit({ rounds: undefined, notes: undefined }, review, 1)
    const ticked = DesignRounds.tick(admitted, [{ feedback: review.id, index: 1, summary: heavy(300) }], 2)
    const shown = DesignRounds.claim(
      { ...admitted, notes: ticked.notes },
      { feedback: review.id, index: 1, status: "resolved", evidence: { job: job.id } },
      [job],
    )
    expect(Object.keys(shown.change ?? {})[0]).toBe("delta")
    const evidence = IntelligenceEvaluation.evidence(shown.change, { limit: DesignStore.REVIEW.change })
    expect(evidence.truncated).toBe(true)
    expect(evidence.content).toStartWith(
      '{"delta":{"changed":true,"pixels":37.5,"text":true,"markup":false,"moved":true,"resized":false,',
    )
    // The judge still reads the whole delta it is asked about, with the free text clipped.
    expect(shown.change?.delta).toMatchObject({ changed: true, pixels: 37.5, text: true, moved: true })
    expect([...(shown.change?.delta?.textBefore ?? "")].length).toBeLessThan(240)
    expect([...(shown.change?.addressed ?? "")].length).toBeLessThan(300)
  })
})
