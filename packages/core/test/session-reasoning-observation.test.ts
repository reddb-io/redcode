import { describe, expect, test } from "bun:test"
import { LLMEvent } from "@opencode/ai"
import { ReasoningObserver } from "@opencode/core/session/reasoning-observer"
import { evaluate } from "../script/reasoning-observation-eval"
import { corpus, chunkEvents, chunkings, repeatedLines } from "./fixture/reasoning-observation"

describe("passive reasoning observation", () => {
  for (const fixture of corpus) {
    test(fixture.id, () => {
      const snapshots = chunkings.map((chunking) => {
        const observer = ReasoningObserver.make()
        chunkEvents(fixture.events, chunking).forEach(observer.observe)
        return observer.finish()
      })
      expect(snapshots[0].observation !== undefined).toBe(fixture.repeated || Boolean(fixture.knownFalsePositive))
      if (fixture.kind) expect(snapshots[0].observation?.kind).toBe(fixture.kind)
      snapshots.forEach((snapshot) => {
        expect(snapshot).toEqual(snapshots[0])
        expect(snapshot.maxLineCodeUnits).toBeLessThanOrEqual(ReasoningObserver.LIMITS.line)
        expect(snapshot.maxPrefixCodeUnits).toBeLessThanOrEqual(ReasoningObserver.LIMITS.prefix)
        expect(snapshot.maxRecentSegments).toBeLessThanOrEqual(ReasoningObserver.LIMITS.segments)
        expect(snapshot.maxPeriodicCodeUnits).toBeLessThanOrEqual(ReasoningObserver.LIMITS.periodic)
      })
    })
  }

  test("keeps state bounded for one huge delta and never exports content or fingerprints", () => {
    const observer = ReasoningObserver.make()
    observer.observe(LLMEvent.reasoningDelta({ id: "private-block", text: "x".repeat(2_000_000) }))
    const snapshot = observer.snapshot()
    expect(snapshot.observation).toBeUndefined()
    expect(snapshot.characters).toBe(2_000_000)
    expect(snapshot.lineCodeUnits).toBe(ReasoningObserver.LIMITS.line)
    expect(snapshot.prefixCodeUnits).toBe(ReasoningObserver.LIMITS.prefix)
    expect(snapshot.periodicCodeUnits).toBe(ReasoningObserver.LIMITS.periodic)
    expect(snapshot.periodicChecks).toBeLessThanOrEqual(
      Math.ceil(snapshot.characters / ReasoningObserver.LIMITS.periodicStride),
    )
    expect(Object.values(snapshot).filter((value) => typeof value === "string")).toEqual([])
    expect(JSON.stringify(snapshot)).not.toContain("private-block")
    expect(observer.finish().lineCodeUnits).toBe(0)
  })

  test("resets on local tool progress and keeps empty text deltas from erasing evidence", () => {
    const observer = ReasoningObserver.make()
    observer.observe(LLMEvent.reasoningDelta({ id: "thought", text: repeatedLines(6) }))
    observer.observe(LLMEvent.textDelta({ id: "empty", text: "" }))
    expect(observer.snapshot().recentSegments).toBe(6)
    observer.progress()
    observer.observe(LLMEvent.reasoningDelta({ id: "thought", text: repeatedLines(6) }))
    expect(observer.finish().observation).toBeUndefined()
  })

  test("latches one scalar observation across progress while each attempt starts fresh", () => {
    const observer = ReasoningObserver.make()
    observer.observe(LLMEvent.reasoningDelta({ id: "thought", text: repeatedLines(12) }))
    const observation = observer.snapshot().observation
    expect(observation).toBeDefined()
    expect(Object.keys(observation!)).toEqual(["version", "kind", "characters", "segments", "period", "repeats"])
    observer.progress()
    observer.observe(LLMEvent.reasoningDelta({ id: "later", text: "reconsider ".repeat(100) }))
    expect(observer.finish().observation).toEqual(observation)
    expect(observer.finish()).toEqual(observer.snapshot())
    const next = ReasoningObserver.make()
    next.observe(LLMEvent.reasoningDelta({ id: "thought", text: repeatedLines(6) }))
    expect(next.finish().observation).toBeUndefined()
  })

  test("reports a reproducible confusion matrix and bounded state", () => {
    const report = evaluate()
    expect(report).toEqual(evaluate())
    expect(report.matrix.falsePositive).toBe(1)
    expect(report.matrix.falseNegative).toBe(0)
    expect(Object.values(report.matrix).reduce((total, count) => total + count, 0)).toBe(corpus.length)
    expect(report.chunkInvariant).toBe(true)
    expect(report.bounded).toBe(true)
    expect(report.knownFalsePositives).toEqual(["inline-quote-known-false-positive"])
    expect(report.cases.filter((fixture) => !fixture.correct).map((fixture) => fixture.id)).toEqual(
      report.knownFalsePositives,
    )
    expect(report.cases.every((fixture) => fixture.matchesBaseline)).toBe(true)
  })
})
