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
  legend: { "0": "calm", "1": "concern", "2": "frustrated", "3": "angry" },
  probabilities: {},
  confidence,
})
const prompt = (
  created: number,
  feedback: string,
  frustration: number,
  extra: Partial<Satisfaction.Evaluation> = {},
) => ({
  operation: "prompt_classification",
  decision: "accepted",
  created,
  answers: { user_feedback: choice(feedback), frustration: score(frustration) },
  ...extra,
})

describe("Satisfaction.sample", () => {
  test("approval with a calm tone is the best value, rejection with anger the worst", () => {
    expect(Satisfaction.sample(prompt(0, "agrees", 0))).toBe(1)
    expect(Satisfaction.sample(prompt(0, "rejects", 3))).toBe(-1)
    expect(Satisfaction.sample(prompt(0, "neutral", 0))).toBe(0)
  })

  test("a correction weighs less than a rejection, and frustration lowers either", () => {
    expect(Satisfaction.sample(prompt(0, "corrects", 0))).toBeCloseTo(-0.4)
    expect(Satisfaction.sample(prompt(0, "neutral", 2))).toBeCloseTo(-0.8 * (2 / 3))
    expect(Satisfaction.sample(prompt(0, "agrees", 3))).toBeCloseTo(0.2)
  })

  test("uses whichever signal is reliable, and none when neither is", () => {
    const unsure = { ...prompt(0, "agrees", 3).answers, user_feedback: choice("agrees", 0.4) }
    expect(Satisfaction.sample({ ...prompt(0, "agrees", 3), answers: unsure })).toBeCloseTo(-0.8)
    const nothing = { user_feedback: choice("agrees", 0.4), frustration: score(3, 0.2) }
    expect(Satisfaction.sample({ ...prompt(0, "agrees", 0), answers: nothing })).toBeUndefined()
    expect(Satisfaction.sample({ ...prompt(0, "agrees", 0), answers: {} })).toBeUndefined()
  })

  test("ignores other operations and unavailable evaluations", () => {
    expect(Satisfaction.sample(prompt(0, "agrees", 0, { operation: "session_progress" }))).toBeUndefined()
    expect(Satisfaction.sample(prompt(0, "agrees", 0, { decision: "unavailable" }))).toBeUndefined()
  })
})

describe("Satisfaction.read", () => {
  test("shows nothing until enough prompts were read", () => {
    expect(Satisfaction.read([])).toBeUndefined()
    expect(Satisfaction.read([prompt(1, "agrees", 0), prompt(2, "agrees", 0)])).toBeUndefined()
  })

  test("maps the mood to five stages", () => {
    const stages = [
      [[["agrees", 0]], "great"],
      [[["agrees", 2]], "good"],
      [[["neutral", 0]], "steady"],
      [[["corrects", 0]], "rough"],
      [[["rejects", 3]], "frustrated"],
    ] as const
    stages.forEach(([[[feedback, frustration]], expected]) => {
      const evaluations = [1, 2, 3].map((created) => prompt(created, feedback, frustration))
      expect(Satisfaction.read(evaluations)?.stage).toBe(expected)
    })
  })

  test("follows the latest prompts, whatever order the evaluations arrive in", () => {
    const rough = [prompt(1, "rejects", 3), prompt(2, "rejects", 2), prompt(3, "corrects", 1)]
    const recovered = [...rough, prompt(4, "agrees", 0), prompt(5, "agrees", 0), prompt(6, "agrees", 0)]
    expect(Satisfaction.read(rough)?.stage).toBe("frustrated")
    expect(Satisfaction.read(recovered)?.stage).toBe("great")
    expect(Satisfaction.read(recovered.toReversed())?.stage).toBe("great")
    expect(Satisfaction.read(recovered)?.samples).toBe(6)
  })

  test("counts only prompts System One read", () => {
    const mixed = [
      prompt(1, "agrees", 0),
      prompt(2, "agrees", 0, { operation: "session_progress" }),
      prompt(3, "agrees", 0, { decision: "unavailable" }),
      prompt(4, "agrees", 0),
    ]
    expect(Satisfaction.read(mixed)).toBeUndefined()
  })

  test("has one glyph per stage, growing", () => {
    expect(Satisfaction.STAGES.map(Satisfaction.glyph)).toEqual(["▁", "▂", "▄", "▆", "█"])
  })
})

describe("Satisfaction with the work's trips", () => {
  const steady = [1, 2, 3, 4].map((created) => prompt(created, "neutral", 0))
  const trip = (guard: string, action: string, at: number, subject?: string) => ({
    guard,
    action,
    at,
    ...(subject ? { subject } : {}),
  })

  test("a turn the harness had to stop pulls the stage down, and recovery earns some back", () => {
    expect(Satisfaction.read(steady)?.stage).toBe("steady")
    const stopped = Satisfaction.read(steady, [trip("stop_loss", "stop", 4), trip("goal", "stop", 4)])
    expect(stopped?.stage).toBe("rough")
    expect(stopped?.stops).toBe(2)
    const recovered = Satisfaction.read(steady, [
      trip("stop_loss", "stop", 4),
      trip("stop_loss", "warn", 4, "outcome:progressed"),
      trip("stop_loss", "warn", 4, "outcome:progressed"),
    ])
    expect(recovered?.stage).toBe("steady")
    expect(recovered?.recovered).toBe(2)
  })

  test("the work moves the mood by a bounded amount, never past what the user said", () => {
    const many = Array.from({ length: 10 }, () => trip("stop_loss", "stop", 4))
    expect(Satisfaction.read(steady, many)?.mood).toBeCloseTo(-0.4)
    const happy = [1, 2, 3].map((created) => prompt(created, "agrees", 0))
    const relieved = Array.from({ length: 10 }, () => trip("stop_loss", "warn", 3, "outcome:progressed"))
    expect(Satisfaction.read(happy, relieved)?.mood).toBe(1)
  })

  test("counts only stops of guards that mean the work fell short, in the recent turns", () => {
    expect(Satisfaction.read(steady, [trip("budget", "stop", 4)])?.stops).toBe(0)
    expect(Satisfaction.read(steady, [trip("stop_loss", "correct", 4)])?.stops).toBe(0)
    const early = [1, 2, 3, 4, 5, 6, 7].map((created) => prompt(created, "neutral", 0))
    // The window starts at the fifth-latest prompt, so a stop before it no longer counts.
    expect(Satisfaction.read(early, [trip("loop", "stop", 2)])?.stops).toBe(0)
    expect(Satisfaction.read(early, [trip("loop", "stop", 3)])?.stops).toBe(1)
  })
})

describe("Satisfaction.progress", () => {
  test("counts the prompts classified and the ones read with enough confidence", () => {
    const unsure = {
      ...prompt(3, "agrees", 0),
      answers: { user_feedback: choice("agrees", 0.4), frustration: score(1, 0.3) },
    }
    const evaluations = [
      prompt(1, "agrees", 0),
      prompt(2, "neutral", 0),
      unsure,
      prompt(4, "agrees", 0, { decision: "unavailable" }),
      prompt(5, "agrees", 0, { operation: "session_progress" }),
    ]
    expect(Satisfaction.progress(evaluations)).toEqual({ classified: 3, usable: 2, needed: 3 })
    expect(Satisfaction.progress([])).toEqual({ classified: 0, usable: 0, needed: 3 })
  })
})
