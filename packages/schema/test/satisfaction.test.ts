import { describe, expect, test } from "bun:test"
import { Satisfaction } from "../src/satisfaction.js"

const choice = (value: string, confidence = 0.9) => ({
  type: "choice" as const,
  choice: value,
  probabilities: { [value]: confidence },
  confidence,
})
const score = (value: number, confidence = 0.9) => ({
  type: "score" as const,
  score: value,
  legend: { "0": "no friction", "1": "unmet expectation", "2": "repeated correction", "3": "repeated failure" },
  probabilities: {},
  confidence,
})
const prompt = (created: number, feedback: string, frustration = 0, extra: Partial<Satisfaction.Evaluation> = {}) => ({
  operation: "prompt_classification",
  decision: "accepted",
  created,
  answers: { user_feedback: choice(feedback), frustration: score(frustration) },
  ...extra,
})

const trip = (guard: string, action: string, at: number, subject?: string) => ({
  guard,
  action,
  at,
  ...(subject ? { subject } : {}),
})

describe("Satisfaction.sample", () => {
  test("corrections and rejection heat the session, confirmed improvement cools it", () => {
    expect(Satisfaction.sample(prompt(0, "corrects"))).toBe(0.2)
    expect(Satisfaction.sample(prompt(0, "rejects"))).toBe(0.35)
    expect(Satisfaction.sample(prompt(0, "agrees"))).toBe(-0.15)
    expect(Satisfaction.sample(prompt(0, "neutral"))).toBe(0)
  })

  test("approval does not cancel evidence of an unresolved issue", () => {
    expect(Satisfaction.sample(prompt(0, "agrees", 3))).toBe(0.4)
    expect(Satisfaction.sample(prompt(0, "neutral", 2))).toBeCloseTo(0.4 * (2 / 3))
    expect(Satisfaction.sample(prompt(0, "rejects", 3))).toBe(0.4)
  })

  test("uses reliable evidence only, ignoring unavailable and unrelated evaluations", () => {
    const unsure = { ...prompt(0, "agrees", 3).answers, user_feedback: choice("agrees", 0.4) }
    expect(Satisfaction.sample({ ...prompt(0, "agrees", 3), answers: unsure })).toBe(0.4)
    const nothing = { user_feedback: choice("agrees", 0.4), frustration: score(3, 0.2) }
    expect(Satisfaction.sample({ ...prompt(0, "agrees"), answers: nothing })).toBeUndefined()
    expect(Satisfaction.sample({ ...prompt(0, "agrees"), answers: {} })).toBeUndefined()
    expect(Satisfaction.sample(prompt(0, "agrees", 0, { operation: "session_progress" }))).toBeUndefined()
    expect(Satisfaction.sample(prompt(0, "agrees", 0, { decision: "unavailable" }))).toBeUndefined()
  })
})

describe("Satisfaction.read", () => {
  test("missing evidence is unknown; reliable neutral history is cool", () => {
    expect(Satisfaction.read([])).toBeUndefined()
    expect(Satisfaction.read([prompt(1, "rejects"), prompt(2, "rejects")])).toBeUndefined()
    expect(Satisfaction.read([1, 2, 3].map((created) => prompt(created, "neutral")))).toMatchObject({
      temperature: 0,
      score: 0,
      stage: "cool",
    })
  })

  test("calm repeated corrections accumulate even without explicit impatience", () => {
    const readings = [1, 2, 3, 4, 5].map((created) => prompt(created, "corrects"))
    expect(Satisfaction.read(readings.slice(0, 3))?.temperature).toBeCloseTo(0.6)
    expect(Satisfaction.read(readings)?.score).toBe(5)
    expect(Satisfaction.read(readings)?.stage).toBe("critical")
  })

  test("neutral continuation and unavailable observations never erase accumulated failures", () => {
    const failed = [1, 2, 3].map((created) => prompt(created, "rejects"))
    const continued = [
      ...failed,
      ...[4, 5, 6, 7, 8, 9].map((created) => prompt(created, "neutral")),
      prompt(10, "agrees", 0, { decision: "unavailable" }),
      { ...prompt(11, "agrees"), answers: { user_feedback: choice("agrees", 0.4) } },
    ]
    expect(Satisfaction.read(failed)?.score).toBe(5)
    expect(Satisfaction.read(continued)?.temperature).toBe(1)
    expect(Satisfaction.read(continued)?.samples).toBe(9)
  })

  test("confirmed improvement cools gradually, in chronological order, without mutating history", () => {
    const failed = [1, 2, 3].map((created) => prompt(created, "rejects"))
    const recovering = [...failed, prompt(4, "agrees")]
    const recovered = [...recovering, ...[5, 6, 7, 8, 9, 10].map((created) => prompt(created, "agrees"))]
    const original = JSON.stringify(recovered)
    expect(Satisfaction.read(recovering)?.temperature).toBeCloseTo(0.85)
    expect(Satisfaction.read(recovered)?.temperature).toBe(0)
    expect(Satisfaction.read(recovered.toReversed())).toEqual(Satisfaction.read(recovered))
    expect(JSON.stringify(recovered)).toBe(original)
  })

  test("clamps after each observation so past approval cannot hide later failures", () => {
    const ratings = [
      ...[1, 2, 3, 4, 5].map((created) => prompt(created, "agrees")),
      ...[6, 7, 8].map((created) => prompt(created, "rejects")),
    ]
    expect(Satisfaction.read(ratings)?.score).toBe(5)
  })

  test("excludes unrelated operations and has a growing glyph for each temperature stage", () => {
    const mixed = [
      prompt(1, "agrees"),
      prompt(2, "agrees", 0, { operation: "session_progress" }),
      prompt(3, "agrees", 0, { decision: "unavailable" }),
      prompt(4, "agrees"),
    ]
    expect(Satisfaction.read(mixed)).toBeUndefined()
    expect([0, 1, 2, 3, 4, 5].map(Satisfaction.glyph)).toEqual(["▯", "▁", "▂", "▄", "▆", "█"])
  })
})

describe("Satisfaction with failure and recovery evidence", () => {
  const steady = [1, 2, 3, 4].map((created) => prompt(created, "neutral"))

  test("stops heat and verified recovery cools, without declaring the user's emotions", () => {
    const stopped = Satisfaction.read(steady, [trip("stop_loss", "stop", 4), trip("goal", "stop", 4)])
    expect(stopped?.temperature).toBeCloseTo(0.2)
    expect(stopped?.stops).toBe(2)
    const recovered = Satisfaction.read(steady, [
      trip("stop_loss", "stop", 4),
      trip("stop_loss", "warn", 5, "outcome:progressed"),
      trip("stop_loss", "warn", 6, "outcome:progressed"),
    ])
    expect(recovered?.temperature).toBe(0)
    expect(recovered?.recovered).toBe(2)
  })

  test("recovery before failure cannot compensate for the later failure", () => {
    const trips = [trip("loop", "stop", 4), trip("stop_loss", "warn", 1, "outcome:progressed")]
    expect(Satisfaction.read(steady, trips)?.temperature).toBeCloseTo(0.1)
    expect(Satisfaction.read(steady, trips.toReversed())).toEqual(Satisfaction.read(steady, trips))
  })

  test("bounds accumulated work evidence and ignores budget stops and evidence outside retained history", () => {
    expect(
      Satisfaction.read(
        steady,
        Array.from({ length: 20 }, (_, index) => trip("loop", "stop", index + 4)),
      )?.temperature,
    ).toBe(1)
    expect(Satisfaction.read(steady, [trip("budget", "stop", 4), trip("loop", "stop", 0)])?.stops).toBe(0)
    expect(Satisfaction.read(steady, [trip("stop_loss", "correct", 4)])?.temperature).toBe(0)
    const continued = [1, 2, 3, 4, 5, 6, 7].map((created) => prompt(created, "neutral"))
    expect(Satisfaction.read(continued, [trip("loop", "stop", 2)])?.stops).toBe(1)
  })
})

describe("Satisfaction.progress", () => {
  test("counts classified and reliable prompts separately", () => {
    const unsure = {
      ...prompt(3, "agrees"),
      answers: { user_feedback: choice("agrees", 0.4), frustration: score(1, 0.3) },
    }
    const evaluations = [
      prompt(1, "agrees"),
      prompt(2, "neutral"),
      unsure,
      prompt(4, "agrees", 0, { decision: "unavailable" }),
      prompt(5, "agrees", 0, { operation: "session_progress" }),
    ]
    expect(Satisfaction.progress(evaluations)).toEqual({ classified: 3, usable: 2, needed: 3 })
    expect(Satisfaction.progress([])).toEqual({ classified: 0, usable: 0, needed: 3 })
  })
})
