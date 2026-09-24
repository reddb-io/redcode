import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { Effect } from "effect"
import { Model } from "@reddb-io/redcode-schema/model"
import { Provider } from "@reddb-io/redcode-schema/provider"
import type { ConfigDesign } from "../src/config/design"
import { DesignIdentify } from "../src/design/identify"
import { DesignProposal } from "../src/design/proposal"
import { DesignTarget } from "../src/design/target"
import { Intelligence } from "../src/intelligence"
import { tmpdir } from "./fixture/tmpdir"

type Question = { readonly type: string; readonly criteria?: Record<string, unknown> | unknown[] }
type Picks = Record<string, readonly [string, number]>

const project = async (root: string) => {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "web", dependencies: { react: "^19.0.0", tailwindcss: "^3.4.0" } }),
    "tailwind.config.ts": "export default {}\n",
    "src/styles/globals.css": "@tailwind base;\n:root {\n  --primary: #111;\n}\n",
    "src/components/Button.tsx": "export function Button() { return <button /> }\n",
  }
  for (const [file, content] of Object.entries(files)) await Bun.write(path.join(root, file), content)
  await mkdir(path.join(root, ".git"), { recursive: true })
}

/** Answers every question System One was asked: picked or first choice, lowest score, unlikely noul. */
const reply = (picks: Picks) => (body: { questions: Record<string, Question> }) =>
  Response.json({
    model: "jev-test",
    answers: Object.fromEntries(
      Object.entries(body.questions).map(([id, question]) => {
        if (question.type === "noul") return [id, { type: "noul", noul: 0.05 }]
        if (question.type === "score")
          return [
            id,
            { type: "score", score: 0, confidence: 0.9, probabilities: { "0": 1 }, legend: { "0": "lowest" } },
          ]
        const labels = Object.keys(question.criteria ?? {})
        const [choice, confidence] = picks[id] ?? [labels[0]!, 0.9]
        const rest = labels.filter((label) => label !== choice)
        return [
          id,
          {
            type: "choice",
            choice,
            confidence,
            probabilities: Object.fromEntries([
              [choice, rest.length ? confidence : 1],
              ...rest.map((label) => [label, (1 - confidence) / rest.length]),
            ]),
          },
        ]
      }),
    ),
    usage: { input_tokens: 40, output_tokens: 8 },
  })

const credentials = {
  get: () => Effect.succeed(undefined),
  list: () => Effect.succeed([]),
  create: () => Effect.die("Credential creation not expected"),
}

const settings = {
  enabled: true,
  reasoning: "dual" as const,
  onboarding: "completed" as const,
  principal: { id: Model.ID.make("main"), providerID: Provider.ID.make("test") },
  evaluator: { transport: "typesafe" as const, baseURL: "https://api.typesafe.ai/v1", model: "jev-test" },
}

const service = (root: string, respond: (body: never) => Response) =>
  Effect.gen(function* () {
    const requests: unknown[] = []
    const intelligence = yield* Intelligence.make(
      root,
      credentials,
      Object.assign(
        (_url: string | URL | Request, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body ?? "{}"))
          requests.push(body)
          return Promise.resolve(respond(body as never))
        },
        { preconnect() {} },
      ),
    )
    yield* intelligence.save({ settings })
    return { intelligence, requests }
  })

describe("target in the first message", () => {
  test("a design-routed classification carries the target, so creating the design makes no further S1 call", async () => {
    await using state = await tmpdir()
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const s1 = yield* service(
          state.path,
          reply({ work_route: ["design", 0.95], design_target: ["app", 0.9], design_platform: ["ios", 0.9] }),
        )
        const evaluation = yield* s1.intelligence
          .evaluate({
            sessionID: "ses_first_turn",
            operation: "prompt_classification",
            kind: "classification",
            sources: { text: "Desenhe um app de corrida para iPhone" },
            questions: Intelligence.promptQuestions,
          })
          .pipe(Effect.orDie)
        const classified = DesignTarget.classified(evaluation)
        const outcome = yield* DesignTarget.choose({
          requested: {},
          forced: undefined,
          mode: "dual",
          classified,
          detect: Effect.die("the classification already carries the target"),
          ask: (request) => Effect.succeed(request.options[0]?.label),
        })
        return { classified, outcome, requests: s1.requests.length }
      }),
    )
    expect(result.requests).toBe(1)
    expect(result.classified).toMatchObject({ target: "app", platform: "ios", confidence: 0.9 })
    expect(result.outcome).toMatchObject({ target: "app", platform: "ios", source: "detected", asked: true })
    expect(result.outcome.note).toContain("from the request classification")
  })

  test("only a design route yields a target, and the newest one wins", () => {
    const evaluation = (route: string, target: string) =>
      ({
        id: `evaluation-${route}-${target}`,
        fingerprint: "fingerprint",
        sessionID: "session",
        operation: "prompt_classification",
        kind: "classification",
        policy: Intelligence.POLICY,
        decision: "accepted",
        model: "jev-test",
        issues: [],
        created: 0,
        duration: 0,
        usage: { input_tokens: 0, output_tokens: 0 },
        answers: {
          work_route: { type: "choice", choice: route, confidence: 0.9, probabilities: { [route]: 1 } },
          design_target: { type: "choice", choice: target, confidence: 0.8, probabilities: { [target]: 1 } },
          design_platform: { type: "choice", choice: "either", confidence: 0.8, probabilities: { either: 1 } },
        },
      }) satisfies Intelligence.Evaluation
    expect(DesignTarget.classified(evaluation("local_change", "app"))).toBeUndefined()
    expect(
      DesignTarget.latest([
        evaluation("answer", "web"),
        evaluation("design", "presentation"),
        evaluation("design", "app"),
      ]),
    ).toMatchObject({ target: "presentation" })
    expect(Object.keys(Intelligence.promptQuestions)).toContain("design_target")
  })
})

describe("skipping the confirmation", () => {
  const ask = (asked: string[]) => (request: ReturnType<typeof DesignTarget.question>) =>
    Effect.sync(() => {
      asked.push(request.question)
      return request.options[0]?.label
    })

  test("a confident detection the agent agrees with is not asked, and the chip names it", async () => {
    const asked: string[] = []
    const outcome = await Effect.runPromise(
      DesignTarget.choose({
        requested: { target: "app", platform: "ios" },
        forced: undefined,
        mode: "dual",
        classified: { target: "app", platform: "ios", confidence: 0.9, reason: "iPhone app" },
        detect: Effect.die("not needed"),
        ask: ask(asked),
      }),
    )
    expect(asked).toHaveLength(0)
    expect(outcome).toMatchObject({ target: "app", platform: "ios", asked: false, settled: true })
    expect(outcome.note).toContain("the user was not asked")
    expect(DesignTarget.chip(outcome, "DS: shadcn/ui (packages/ui)")).toStartWith(
      "iOS app · DS: shadcn/ui (packages/ui) — change",
    )
  })

  test("disagreement or a less confident detection is asked", async () => {
    for (const [requested, confidence] of [
      [{ target: "web" as const }, 0.95],
      [{ target: "app" as const, platform: "ios" as const }, 0.8],
    ] as const) {
      const asked: string[] = []
      const outcome = await Effect.runPromise(
        DesignTarget.choose({
          requested,
          forced: undefined,
          mode: "dual",
          classified: { target: "app", platform: "ios", confidence, reason: "iPhone app" },
          detect: Effect.die("not needed"),
          ask: ask(asked),
        }),
      )
      expect(asked).toHaveLength(1)
      expect(outcome.asked).toBe(true)
    }
  })

  test("a design system System One and the scan agree on is used without asking and without writing config", async () => {
    await using tmp = await tmpdir()
    await using state = await tmpdir()
    await project(tmp.path)
    const asked: string[] = []
    const adopted: (ConfigDesign.Effective | undefined)[] = []
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const s1 = yield* service(
          state.path,
          reply({
            present: ["yes", 0.95],
            kind: ["tailwind", 0.9],
            library: ["own", 0.9],
            framework: ["react", 0.95],
            components: ["src/components", 0.9],
            css: ["src/styles/globals.css", 0.9],
          }),
        )
        const input = (auto: boolean) => ({
          directory: tmp.path,
          state: path.join(state.path, DesignProposal.STATE),
          configured: false,
          auto,
          identify: () =>
            DesignIdentify.identify({
              directory: tmp.path,
              state: path.join(state.path, DesignIdentify.STATE),
              mode: "dual" as const,
              sessionID: "ses_first_turn",
              evaluate: (evaluation) => s1.intelligence.evaluate(evaluation),
            }),
          ask: (request: ReturnType<typeof DesignProposal.question>) =>
            Effect.sync(() => {
              asked.push(request.question)
              return "Edit later"
            }),
          adopt: (design: ConfigDesign.Effective | undefined) => Effect.sync(() => void adopted.push(design)),
        })
        const automatic = yield* DesignProposal.around(input(true), Effect.succeed("created"))
        // Refresh never skips: it asks whether to save the system.
        const refreshed = yield* DesignProposal.decide(input(false))
        return { automatic, refreshed }
      }),
    )
    expect(result.automatic.decision).toMatchObject({ status: "yes", automatic: true })
    expect(result.automatic.decision.identification?.agreement).toBe(true)
    expect(result.automatic.report).toContain("without asking")
    expect(adopted[0]?.system?.paths).toEqual(["src/components"])
    expect(DesignProposal.chip(result.automatic.decision)).toBe("DS: Tailwind theme (src/components)")
    expect(await Bun.file(path.join(tmp.path, "redcode.json")).exists()).toBe(false)
    expect(result.refreshed.status).toBe("later")
    expect(asked).toHaveLength(1)
  })
})

describe("background identification", () => {
  test("starts for the design agent or a design route and is reused by the design it prepares", async () => {
    expect(DesignIdentify.wanted({ agent: "design" })).toBe(true)
    expect(DesignIdentify.wanted({ agent: "build", route: "design" })).toBe(true)
    expect(DesignIdentify.wanted({ agent: "build", route: "local_change" })).toBe(false)
    await using tmp = await tmpdir()
    await using state = await tmpdir()
    await project(tmp.path)
    let calls = 0
    await Effect.runPromise(
      Effect.gen(function* () {
        const s1 = yield* service(state.path, reply({ present: ["yes", 0.9] }))
        const input = {
          directory: tmp.path,
          state: path.join(state.path, DesignIdentify.STATE),
          mode: "dual" as const,
          sessionID: "ses_first_turn",
          evaluate: (evaluation: Intelligence.EvaluationInput) => {
            calls++
            return s1.intelligence.evaluate(evaluation)
          },
        }
        // The warm-up and a design created while it runs share one System One call.
        const [, identified] = yield* Effect.all([DesignIdentify.warm(input), DesignIdentify.identify(input)], {
          concurrency: "unbounded",
        })
        expect(identified.source).toBe("system-one")
        // A later design reads the cached result.
        yield* DesignIdentify.identify(input)
        // Single reasoning has nothing to warm.
        yield* DesignIdentify.warm({ ...input, mode: "single" })
      }),
    )
    expect(calls).toBe(1)
  })
})

describe("per-project default", () => {
  test("the last settled target is preselected for the next design in the project", async () => {
    await using tmp = await tmpdir()
    await using state = await tmpdir()
    const memory = path.join(state.path, DesignTarget.STATE)
    expect(await DesignTarget.recall(memory, tmp.path)).toBeUndefined()
    await DesignTarget.remember(memory, tmp.path, { target: "presentation" })
    const remembered = await DesignTarget.recall(memory, tmp.path)
    expect(remembered).toEqual({ target: "presentation" })
    const asked: ReturnType<typeof DesignTarget.question>[] = []
    const outcome = await Effect.runPromise(
      DesignTarget.choose({
        requested: {},
        forced: undefined,
        mode: "dual",
        remembered,
        detect: Effect.succeed(undefined),
        ask: (request) =>
          Effect.sync(() => {
            asked.push(request)
            return request.options[0]?.label
          }),
      }),
    )
    expect(asked[0]!.options[0]!.label).toBe("Presentation (Recommended)")
    expect(asked[0]!.question).toContain("the last target chosen in this project")
    expect(outcome).toMatchObject({ target: "presentation", source: "fallback", settled: true })
  })
})
