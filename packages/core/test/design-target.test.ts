import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Effect } from "effect"
import { Intelligence } from "@opencode/schema/intelligence"
import { DesignPlaybooks } from "../src/design/playbooks"
import { DesignTarget } from "../src/design/target"
import { DesignTargetCriteria } from "../src/design/target-criteria"
import type { EvaluationInput } from "../src/intelligence"
import { tmpdir } from "./fixture/tmpdir"

type Asked = ReturnType<typeof DesignTarget.question>

const choice = (label: string, confidence: number, probabilities: Record<string, number>): Intelligence.Answer => ({
  type: "choice",
  choice: label,
  confidence,
  probabilities,
})

/** An accepted System One evaluation of the given input with the given answers. */
const evaluated = (
  input: EvaluationInput,
  answers: Record<string, Intelligence.Answer>,
  decision: Intelligence.Evaluation["decision"] = "accepted",
): Intelligence.Evaluation => ({
  id: "evaluation-target",
  fingerprint: "fingerprint-target",
  sessionID: input.sessionID,
  operation: input.operation,
  policy: "test",
  decision,
  model: "jev-test",
  answers,
  issues: decision === "unavailable" ? ["System One is down"] : [],
  created: 0,
  duration: 0,
  usage: { input_tokens: 20, output_tokens: 2 },
})

/** The `design_target` classification of one request, answered by System One; `calls` records each input. */
const systemOne = (request: string, answers: Record<string, Intelligence.Answer>) => {
  const calls: EvaluationInput[] = []
  const input = DesignTarget.evaluation({
    sessionID: "ses_design_target",
    requests: [request],
    design: { name: "Design", kind: "screen" },
  })
  const detect = Effect.sync(() => {
    calls.push(input)
    return evaluated(input, answers)
  })
  return { calls, detect }
}

const iosApp = {
  target: choice("app", 0.9, { web: 0.05, app: 0.9, presentation: 0.05 }),
  platform: choice("ios", 0.8, { ios: 0.8, android: 0.05, either: 0.15 }),
}

describe("DesignTarget", () => {
  test("routes each target to its playbooks", () => {
    expect(DesignPlaybooks.forTarget(undefined)).toEqual(["screen", "flow", "quality"])
    expect(DesignPlaybooks.forTarget("app")).toEqual(["mobile-app", "quality"])
    expect(DesignPlaybooks.forTarget("presentation")).toEqual(["slides"])
    const targets = ["web", "app", "presentation"] as const
    expect(targets.flatMap((target) => DesignPlaybooks.forTarget(target)).every((id) => DesignPlaybooks.find(id))).toBe(
      true,
    )
    expect(DesignTarget.describe({ target: "app", platform: "ios" })).toBe(
      "Target: iOS app · playbooks: mobile-app, quality",
    )
    expect(DesignTarget.chip({ target: "presentation" }, "DS: none")).toStartWith("Presentation · DS: none — change:")
  })

  test("the confirmation puts the proposal first, marked recommended, and maps every answer back", () => {
    const asked = DesignTarget.question({ target: "app" }, "detail")
    expect(asked.header).toBe(DesignTarget.HEADER)
    expect(asked.custom).toBe(false)
    expect(asked.options.map((option) => option.label)).toEqual([
      "Mobile app (Recommended)",
      "Web",
      "iOS app",
      "Android app",
      "Presentation",
    ])
    expect(DesignTarget.answer("Mobile app (Recommended)")).toEqual({ target: "app" })
    expect(DesignTarget.answer("Android app")).toEqual({ target: "app", platform: "android" })
    expect(DesignTarget.answer("Presentation")).toEqual({ target: "presentation" })
    expect(DesignTarget.answer(undefined)).toBeUndefined()
    expect(DesignTarget.answer("Something else")).toBeUndefined()
  })

  test("the classification asks System One to choose between the shared target and platform criteria", () => {
    const input = DesignTarget.evaluation({
      sessionID: "ses_design_target",
      requests: ["first", "second", "third", "Quero um app de corrida para iPhone"],
      design: { name: "Runner", kind: "flow" },
    })
    expect(input.operation).toBe("design_target")
    expect(input.kind).toBe("classification")
    expect(Object.keys(input.questions).toSorted()).toEqual(["platform", "target"])
    expect(input.questions.target).toMatchObject({ type: "choice", criteria: DesignTargetCriteria.TARGETS })
    expect(input.questions.platform).toMatchObject({ type: "choice", criteria: DesignTargetCriteria.PLATFORMS })
    // Only the latest three requests are evidence.
    const sources = JSON.stringify(input.sources)
    expect(sources).toContain("app de corrida")
    expect(sources).not.toContain("first")
  })

  test("dual reasoning classifies the request with System One and preselects the detection", async () => {
    const s1 = systemOne("Quero um app de corrida para iPhone", iosApp)
    const asked: Asked[] = []
    const outcome = await Effect.runPromise(
      DesignTarget.choose({
        requested: { target: "web" },
        forced: undefined,
        mode: "dual",
        detect: s1.detect,
        ask: (request) =>
          Effect.sync(() => {
            asked.push(request)
            return request.options[0]?.label
          }),
      }),
    )
    expect(s1.calls).toHaveLength(1)
    expect(asked).toHaveLength(1)
    expect(asked[0]?.options[0]?.label).toBe("iOS app (Recommended)")
    expect(asked[0]?.question).toContain("System One suggests iOS app (90% confident)")
    expect(outcome).toMatchObject({ target: "app", platform: "ios", source: "detected", asked: true, settled: true })
    expect(outcome.note).toContain("detected by System One and confirmed by the user")
  })

  test("a confident detection the design agent agrees with is taken without asking", async () => {
    const s1 = systemOne("An iPhone running app", {
      target: choice("app", 0.95, { web: 0.02, app: 0.95, presentation: 0.03 }),
      platform: choice("ios", 0.9, { ios: 0.9, android: 0.05, either: 0.05 }),
    })
    const outcome = await Effect.runPromise(
      DesignTarget.choose({
        requested: { target: "app", platform: "ios" },
        forced: undefined,
        mode: "dual",
        detect: s1.detect,
        ask: () => Effect.die("an agreed target is not confirmed"),
      }),
    )
    expect(outcome).toMatchObject({ target: "app", platform: "ios", source: "detected", asked: false, settled: true })
    expect(outcome.note).toContain("and the design agent agree, so the user was not asked")
  })

  test("the user can override the detection", async () => {
    const s1 = systemOne("A landing page", {
      target: choice("web", 0.7, { web: 0.7, app: 0.2, presentation: 0.1 }),
      platform: choice("either", 1, { ios: 0, android: 0, either: 1 }),
    })
    const outcome = await Effect.runPromise(
      DesignTarget.choose({
        requested: {},
        forced: undefined,
        mode: "dual",
        detect: s1.detect,
        ask: () => Effect.succeed("Presentation"),
      }),
    )
    expect(outcome).toMatchObject({ target: "presentation", source: "user" })
    expect(outcome.platform).toBeUndefined()
  })

  test("single reasoning makes no System One call and takes the agent's tool parameters", async () => {
    const s1 = systemOne("An Android app", iosApp)
    const outcome = await Effect.runPromise(
      DesignTarget.choose({
        requested: { target: "app", platform: "android" },
        forced: undefined,
        mode: "single",
        detect: s1.detect,
        ask: () => Effect.die("single reasoning asks nothing"),
      }),
    )
    expect(s1.calls).toHaveLength(0)
    expect(outcome).toMatchObject({ target: "app", platform: "android", source: "agent" })
    expect(outcome.note).toContain("no S1 call")
  })

  test("a forced target skips detection and the question", async () => {
    const outcome = await Effect.runPromise(
      DesignTarget.choose({
        requested: { target: "web" },
        forced: { target: "presentation" },
        mode: "dual",
        detect: Effect.die("a forced target is not detected"),
        ask: () => Effect.die("a forced target is not confirmed"),
      }),
    )
    expect(outcome).toMatchObject({ target: "presentation", source: "flag" })
    expect(outcome.note).toContain("--target")
  })

  test("a System One failure preselects the agent's choice and says so", async () => {
    const asked: Asked[] = []
    const input = DesignTarget.evaluation({
      sessionID: "ses_design_target",
      requests: ["Slides for the quarterly review"],
      design: { name: "Design", kind: "screen" },
    })
    const outcome = await Effect.runPromise(
      DesignTarget.choose({
        requested: { target: "presentation" },
        forced: undefined,
        mode: "dual",
        detect: Effect.succeed(evaluated(input, {}, "unavailable")),
        ask: (request) =>
          Effect.sync(() => {
            asked.push(request)
            return undefined
          }),
      }),
    )
    expect(asked[0]?.options[0]?.label).toBe("Presentation (Recommended)")
    expect(asked[0]?.question).toContain("System One could not classify the request (System One is down)")
    expect(outcome).toMatchObject({ target: "presentation", source: "fallback", settled: false })
    expect(outcome.note).toContain("System One unavailable")
  })

  test("without an agent choice a failure falls back to the project's last target, then to web", async () => {
    const failed = (remembered?: DesignTarget.Choice) =>
      Effect.runPromise(
        DesignTarget.choose({
          requested: {},
          forced: undefined,
          mode: "dual",
          detect: Effect.fail("unreachable"),
          ...(remembered ? { remembered } : {}),
          ask: () => Effect.succeed(undefined),
        }),
      )
    expect(await failed()).toMatchObject({ target: "web", source: "fallback" })
    const remembered = await failed({ target: "app", platform: "android" })
    expect(remembered).toMatchObject({ target: "app", platform: "android", source: "fallback" })
    expect(remembered.note).toContain("the last target chosen in this project")
  })

  test("a design-routed prompt classification settles the detection without another System One call", async () => {
    const input = DesignTarget.evaluation({
      sessionID: "ses_design_target",
      requests: ["Slides"],
      design: { name: "Design", kind: "screen" },
    })
    const routed = (route: string, confidence: number) =>
      evaluated(input, {
        work_route: choice(route, confidence, { [route]: confidence }),
        design_target: choice("presentation", 0.8, { web: 0.1, app: 0.1, presentation: 0.8 }),
        design_platform: choice("either", 1, { either: 1 }),
      })
    expect(DesignTarget.classified(routed("code", 0.9))).toBeUndefined()
    expect(DesignTarget.classified(routed("design", 0.5))).toBeUndefined()
    const classified = DesignTarget.latest([routed("code", 0.9), routed("design", 0.8)])
    expect(classified).toMatchObject({ target: "presentation", confidence: 0.8 })

    const asked: Asked[] = []
    const outcome = await Effect.runPromise(
      DesignTarget.choose({
        requested: {},
        forced: undefined,
        mode: "dual",
        detect: Effect.die("a classified request is not detected again"),
        classified,
        ask: (request) =>
          Effect.sync(() => {
            asked.push(request)
            return request.options[0]?.label
          }),
      }),
    )
    expect(asked[0]?.question).toContain("System One suggests Presentation from the request classification (80%")
    expect(outcome.note).toContain("detected by System One from the request classification and confirmed by the user")
  })

  test("a detection keeps a platform only for an app", () => {
    const input = DesignTarget.evaluation({
      sessionID: "ses_design_target",
      requests: ["A site"],
      design: { name: "Design", kind: "screen" },
    })
    expect(
      DesignTarget.detection(
        evaluated(input, {
          target: choice("web", 0.9, { web: 0.9 }),
          platform: choice("ios", 0.9, { ios: 0.9 }),
        }),
      ),
    ).toEqual({ target: "web", confidence: 0.9, reason: DesignTargetCriteria.TARGETS.web })
    expect(DesignTarget.detection(evaluated(input, { target: choice("kiosk", 0.9, { kiosk: 0.9 }) }))).toBeUndefined()
    expect(DesignTarget.detection(undefined)).toBeUndefined()
  })

  test("the settled target is remembered per project, with a platform only for an app", async () => {
    await using state = await tmpdir()
    await using project = await tmpdir()
    const file = path.join(state.path, DesignTarget.STATE)
    expect(await DesignTarget.recall(file, project.path)).toBeUndefined()
    await DesignTarget.remember(file, project.path, { target: "app", platform: "ios" })
    expect(await DesignTarget.recall(file, project.path)).toEqual({ target: "app", platform: "ios" })
    await DesignTarget.remember(file, project.path, { target: "presentation", platform: "android" })
    expect(await DesignTarget.recall(file, project.path)).toEqual({ target: "presentation" })
    expect(await DesignTarget.recall(file, state.path)).toBeUndefined()
  })
})
