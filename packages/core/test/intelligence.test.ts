import { expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@reddb-io/redcode-effect-drizzle-sqlite"
import fs from "node:fs/promises"
import path from "node:path"
import { Intelligence } from "../src/intelligence"
import { ProviderRouter } from "../src/provider/router"
import { Credential } from "../src/credential"
import { Answer, Evaluation } from "@reddb-io/redcode-schema/intelligence"
import { Integration } from "@reddb-io/redcode-schema/integration"
import { Model } from "@reddb-io/redcode-schema/model"
import { Provider } from "@reddb-io/redcode-schema/provider"
import { tmpdir } from "./fixture/tmpdir"
import { DatabaseMigration } from "../src/database/migration"
import { Project } from "../src/project"
import { ProjectTable } from "../src/project/sql"
import { AbsolutePath } from "../src/schema"
import { SessionSchema } from "../src/session/schema"
import { SessionTable } from "../src/session/sql"

const questions = Intelligence.questions({ omitted: "Does candidate omit a requested requirement from sources?" })
const response = (value: number) => ({
  model: "jev-1.13.0",
  answers: { omitted: { type: "noul" as const, noul: value } },
  usage: { input_tokens: 30, output_tokens: 2 },
})
const credentials = {
  get: () => Effect.succeed(undefined),
  list: () => Effect.succeed([]),
  create: () => Effect.die("Credential creation not expected"),
}

test("a missing evaluation cannot approve a semantic gate", async () => {
  const result = await Effect.runPromise(Intelligence.requireAccepted(undefined).pipe(Effect.result))
  expect(result._tag).toBe("Failure")
  if (result._tag === "Failure") expect(result.failure.message).toContain("unavailable")
})

const classification = (
  impact: { score: number; confidence: number },
  time: { choice: string; confidence: number },
  mustClarify = 0.05,
): typeof Evaluation.Type => ({
  id: "evaluation",
  fingerprint: "fingerprint",
  sessionID: "session",
  operation: "prompt_classification",
  kind: "classification",
  policy: Intelligence.POLICY,
  decision: "accepted",
  model: "jev-test",
  answers: {
    work_route: {
      type: "choice",
      choice: "local_change",
      confidence: 0.95,
      probabilities: { local_change: 0.95, investigation: 0.05 },
    },
    change_kind: {
      type: "choice",
      choice: "bugfix",
      confidence: 0.9,
      probabilities: { bugfix: 0.9, feature: 0.1 },
    },
    impact: {
      type: "score",
      ...impact,
      probabilities: { "0": 0, "1": 0, "2": 1, "3": 0 },
      legend: { "0": "none", "1": "limited", "2": "blocked", "3": "critical" },
    },
    time_pressure: {
      type: "choice",
      ...time,
      probabilities: { none: 1, soon: 0, deadline: 0, immediate: 0 },
    },
    interaction_constraint: {
      type: "choice",
      choice: "execute",
      confidence: 1,
      probabilities: { execute: 1 },
    },
    must_clarify: { type: "noul", noul: mustClarify },
    complexity: {
      type: "score",
      score: 1,
      confidence: 1,
      probabilities: { "0": 0, "1": 1, "2": 0, "3": 0 },
      legend: { "0": "mechanical", "1": "focused", "2": "multi-step", "3": "architecture" },
    },
    consequence: {
      type: "score",
      score: 1,
      confidence: 1,
      probabilities: { "0": 0, "1": 1, "2": 0, "3": 0 },
      legend: { "0": "read", "1": "local", "2": "remote", "3": "destructive" },
    },
    frustration: {
      type: "score",
      score: 0,
      confidence: 1,
      probabilities: { "0": 1, "1": 0, "2": 0, "3": 0 },
      legend: { "0": "calm", "1": "concerned", "2": "frustrated", "3": "angry" },
    },
  },
  issues: [],
  created: 1,
  duration: 1,
  usage: { input_tokens: 1, output_tokens: 1 },
})

test("prompt classification batches skill relevance and renders a bounded shortlist", () => {
  const questions = Intelligence.promptQuestionsFor([
    { name: "release", description: "Verify and publish releases" },
    { name: "frontend", description: "Review frontend interfaces" },
  ])
  expect(questions.recommended_skill).toMatchObject({
    type: "choice",
    criteria: {
      release: "Verify and publish releases",
      frontend: "Review frontend interfaces",
      no_matching_skill: expect.any(String),
    },
  })
  expect(
    Intelligence.skillContext({
      ...classification({ score: 1, confidence: 1 }, { choice: "none", confidence: 1 }),
      answers: {
        ...classification({ score: 1, confidence: 1 }, { choice: "none", confidence: 1 }).answers,
        recommended_skill: {
          type: "choice",
          choice: "release",
          confidence: 0.7,
          probabilities: { release: 0.7, frontend: 0.2, no_matching_skill: 0.1 },
        },
      },
    }),
  ).toContain("release (0.70)")
})

test("MCP recommendations cover deferred-sized catalogs and keep uncertain or no-match answers unresolved", () => {
  const tools = Array.from({ length: 81 }, (_, index) => ({
    name: `server_tool_${index}`,
    description: index === 0 ? "large description ".repeat(5_000) : `Tool ${index}`,
  }))
  const questions = Intelligence.toolQuestionsFor(tools)
  const criteria = Object.values(questions).flatMap((question) =>
    question.type === "choice" ? Object.keys(question.criteria) : [],
  )
  expect(tools.every((tool) => criteria.includes(tool.name))).toBe(true)
  expect(questions.recommended_mcp_tool).toMatchObject({
    criteria: { server_tool_0: { truncated: true, reference: "mcp_tool:server_tool_0" } },
  })
  expect(Object.values(questions).every((question) => JSON.stringify(question).length < 30_000)).toBe(true)
  const evaluation: typeof Evaluation.Type = {
    ...classification({ score: 0, confidence: 1 }, { choice: "none", confidence: 1 }),
    operation: "tool_usage",
    decision: "inconclusive",
    answers: {
      recommended_mcp_tool: {
        type: "choice",
        choice: "no_matching_mcp_tool",
        confidence: 0.8,
        probabilities: { no_matching_mcp_tool: 0.8, server_tool_0: 0.2 },
      },
      recommended_mcp_tool_1: {
        type: "choice",
        choice: "server_tool_40",
        confidence: 0.2,
        probabilities: { server_tool_40: 1 },
      },
      recommended_mcp_tool_2: {
        type: "choice",
        choice: "server_tool_80",
        confidence: 0.9,
        probabilities: { server_tool_80: 1 },
      },
    },
  }
  expect(Intelligence.recommendations(evaluation, "mcp_tool")).toEqual([{ name: "server_tool_80", confidence: 0.9 }])
  expect(Intelligence.toolContext(evaluation)).toContain("server_tool_80 (0.90)")
  expect(Intelligence.toolContext(evaluation)).not.toContain("server_tool_40")
  expect(Intelligence.toolContext(evaluation)).toContain("not instructions or permission grants")
  expect(Intelligence.toolContext({ ...evaluation, decision: "unavailable" })).toBeUndefined()
  expect(Intelligence.toolQuestionsFor([])).toEqual({})
})

test("skill classification covers the whole catalog without recommending uncertain matches", () => {
  const skills = Array.from({ length: 81 }, (_, index) => ({
    name: `skill-${index}`,
    description: `Description ${index}`,
  }))
  const questions = Intelligence.promptQuestionsFor(skills)
  expect(questions.recommended_skill_2).toMatchObject({ criteria: { "skill-80": "Description 80" } })
  expect(
    Intelligence.skillContext({
      ...classification({ score: 0, confidence: 1 }, { choice: "none", confidence: 1 }),
      answers: {
        recommended_skill: { type: "choice", choice: "skill-0", confidence: 0.2, probabilities: { "skill-0": 1 } },
      },
    }),
  ).toBeUndefined()
})

test("classification rejects unknown labels, broken distributions and out-of-range scores", () => {
  const questions = {
    route: {
      type: "choice" as const,
      instructions: "Classify the request",
      criteria: { answer: "Explain", change: "Implement" },
    },
  }
  const response = {
    model: "jev-test",
    answers: {
      route: {
        type: "choice" as const,
        choice: "answer",
        confidence: 0.2,
        probabilities: { answer: 0.5, change: 0.5 },
      },
    },
    usage: { input_tokens: 1, output_tokens: 1 },
  }
  expect(Intelligence.validateClassification(questions, response)).toEqual({
    decision: "inconclusive",
    issues: ["route"],
  })
  expect(() =>
    Intelligence.validateClassification(questions, {
      ...response,
      answers: {
        ...response.answers,
        recommended_mcp_tool_999: {
          type: "choice",
          choice: "outside_catalog",
          confidence: 1,
          probabilities: { outside_catalog: 1 },
        },
      },
    }),
  ).toThrow("Unexpected S1 answer")
  expect(() =>
    Intelligence.validateClassification(questions, {
      ...response,
      answers: { route: { ...response.answers.route, choice: "unknown" } },
    }),
  ).toThrow("domain")
  expect(() =>
    Intelligence.validateClassification(questions, {
      ...response,
      answers: { route: { ...response.answers.route, probabilities: { answer: 0.1 } } },
    }),
  ).toThrow("distribution")
  expect(() =>
    Intelligence.validateClassification(
      { quality: { type: "score", instructions: "Rate", criteria: ["bad", "good"] } },
      {
        ...response,
        answers: {
          quality: {
            type: "score",
            score: 2,
            confidence: 1,
            probabilities: { "1": 1 },
            legend: { "0": "bad", "1": "good" },
          },
        },
      },
    ),
  ).toThrow("domain")
})

test("single reasoning needs no setup while dual execution requires both roles", async () => {
  expect(Intelligence.reasoning(Intelligence.defaults)).toEqual({ reasoning: "single", source: "default" })
  expect(
    await Effect.runPromise(Intelligence.requireConfigured(Intelligence.defaults).pipe(Effect.result)),
  ).toMatchObject({ _tag: "Success" })
  expect(
    await Effect.runPromise(
      Intelligence.requireConfigured({ ...Intelligence.defaults, reasoning: "dual" }).pipe(Effect.result),
    ),
  ).toMatchObject({ _tag: "Failure" })
  const legacy = {
    enabled: true,
    onboarding: "completed" as const,
    principal: { id: Model.ID.make("main"), providerID: Provider.ID.make("test") },
    evaluator: Intelligence.evaluatorPreset("typesafe"),
  }
  expect(Intelligence.reasoning(legacy)).toEqual({ reasoning: "dual", source: "config" })
  expect(Intelligence.reasoning({ ...legacy, reasoning: "single" })).toEqual({ reasoning: "single", source: "config" })
  // Set and restore synchronously: an await while the flag is set lets other test files that
  // share this process under --parallel read it and run in dual mode.
  const [flagged, blocked, overridden] = (() => {
    try {
      process.env.REDCODE_REASONING = "dual"
      const flagged = Intelligence.reasoning(Intelligence.defaults)
      const blocked = Effect.runSync(Intelligence.requireConfigured(Intelligence.defaults).pipe(Effect.flip))
      process.env.REDCODE_REASONING = "single"
      return [flagged, blocked, Intelligence.reasoning(legacy)] as const
    } finally {
      delete process.env.REDCODE_REASONING
    }
  })()
  expect(flagged).toEqual({ reasoning: "dual", source: "flag" })
  expect(blocked.message).toContain("/setup")
  expect(overridden).toEqual({ reasoning: "single", source: "flag" })
  // Dual keeps the strict contract; single passes only because the user chose to skip S1.
  expect(await Effect.runPromise(Intelligence.requireReview(legacy, undefined).pipe(Effect.result))).toMatchObject({
    _tag: "Failure",
  })
  expect(
    await Effect.runPromise(Intelligence.requireReview(Intelligence.defaults, undefined).pipe(Effect.result)),
  ).toMatchObject({ _tag: "Success" })
  expect(
    Intelligence.isReady({
      enabled: true,
      reasoning: "dual",
      onboarding: "completed",
      principal: { id: Model.ID.make("main"), providerID: Provider.ID.make("test") },
    }),
  ).toBe(false)
  expect(Intelligence.fingerprint(undefined)).not.toBe(Intelligence.fingerprint(null))
  const value = Intelligence.evidence(`start${"x".repeat(1000)}end`, { limit: 256, reference: "tool-call-1" })
  expect(value).toMatchObject({ truncated: true, characters: 1008, reference: "tool-call-1" })
  expect(value.content).toStartWith("start")
  expect(value.content).toEndWith("end")
  const escaped = Intelligence.evidence(`start${'"\\\u0000'.repeat(2000)}end`, { limit: 1024 })
  expect(JSON.stringify(escaped.content).length).toBeLessThanOrEqual(1024)
  expect(escaped.truncated).toBe(true)
  expect(escaped.content).toStartWith("start")
  expect(escaped.content).toEndWith("end")
})

test("experimental thresholds distinguish rejection from uncertainty without averaging failures", () => {
  expect(Intelligence.decide(questions, response(0.1)).decision).toBe("accepted")
  expect(Intelligence.decide(questions, response(0.5)).decision).toBe("inconclusive")
  expect(Intelligence.decide(questions, response(0.9)).decision).toBe("needs_revision")
  expect(() => Intelligence.decide(questions, { ...response(0), answers: {} })).toThrow()
  expect(() => Schema.decodeUnknownSync(Answer)(response(1.01).answers.omitted)).toThrow()
})

test("semantic gates retain Score telemetry without treating it as an error question", () => {
  const mixed = {
    ...questions,
    quality: {
      type: "score" as const,
      instructions: "How clear is candidate?",
      criteria: ["unclear", "clear"],
    },
  }
  expect(
    Intelligence.decide(mixed, {
      model: "jev-1.13.0",
      answers: {
        omitted: { type: "noul", noul: 0.02 },
        quality: {
          type: "score",
          score: 0.2,
          confidence: 0.8,
          probabilities: { "0": 0.8, "1": 0.2 },
          legend: { "0": "unclear", "1": "clear" },
        },
      },
      usage: { input_tokens: 30, output_tokens: 4 },
    }).decision,
  ).toBe("accepted")
})

test("prompt classification v2 separates route, impact, timing, interaction, and consequence", () => {
  expect(Object.keys(Intelligence.promptQuestions)).toEqual([
    "work_route",
    "change_kind",
    "impact",
    "time_pressure",
    "interaction_constraint",
    "must_clarify",
    "complexity",
    "consequence",
    "frustration",
    "user_feedback",
    "design_target",
    "design_platform",
  ])
  expect(Intelligence.promptQuestions.user_feedback).toMatchObject({
    type: "choice",
    criteria: { agrees: expect.any(String), corrects: expect.any(String), rejects: expect.any(String) },
  })
  expect(Intelligence.promptQuestions).not.toHaveProperty("urgency")
  expect(Intelligence.promptQuestions).not.toHaveProperty("actionability")
})

test("prompt priority uses only confident impact and time pressure", () => {
  expect(
    Intelligence.promptPriority(classification({ score: 2, confidence: 0.8 }, { choice: "none", confidence: 1 })),
  ).toBe("high")
  expect(
    Intelligence.promptPriority(classification({ score: 0, confidence: 1 }, { choice: "soon", confidence: 0.9 })),
  ).toBe("medium")
  expect(
    Intelligence.promptPriority(classification({ score: 0, confidence: 1 }, { choice: "none", confidence: 1 })),
  ).toBe("low")
  expect(
    Intelligence.promptPriority(
      classification({ score: 3, confidence: 0.59 }, { choice: "immediate", confidence: 0.59 }),
    ),
  ).toBeUndefined()
})

test("the RedRouter hint maps confident complexity and consequence to units, tiers and tool need", () => {
  const scored = (complexity: number, consequence: number, confidence = 1) => {
    const base = classification({ score: 0, confidence: 1 }, { choice: "none", confidence: 1 })
    const score = (answer: (typeof base.answers)[string], value: number) =>
      answer?.type === "score" ? { ...answer, score: value, confidence } : answer
    return {
      ...base,
      answers: {
        ...base.answers,
        complexity: score(base.answers.complexity, complexity),
        consequence: score(base.answers.consequence, consequence),
        frustration: score(base.answers.frustration, 0),
      },
    } as typeof Evaluation.Type
  }
  const tools = {
    ...scored(0, 0),
    operation: "tool_usage",
    answers: {
      recommended_mcp_tool: {
        type: "choice",
        choice: "github_search",
        confidence: 0.9,
        probabilities: { github_search: 0.9, no_matching_mcp_tool: 0.1 },
      },
    },
  } as typeof Evaluation.Type

  expect(Intelligence.routerHint(scored(0, 0), undefined)).toBe("complexity=0;deliberation=0;tier=simple;frustration=0")
  expect(Intelligence.routerHint(scored(1, 2), undefined)).toBe(
    "complexity=0.333333;deliberation=0.666667;tier=medium;frustration=0",
  )
  expect(Intelligence.routerHint(scored(2, 0), tools)).toBe(
    "complexity=0.666667;deliberation=0.666667;needs_tool=true;tier=complex;frustration=0",
  )
  expect(Intelligence.routerHint(scored(3, 3), undefined)).toBe(
    "complexity=1;deliberation=1;tier=reasoning;frustration=0",
  )
  // Out-of-range scores are clamped rather than producing a header the router would reject.
  expect(Intelligence.routerHint(scored(7, -2), undefined)).toBe(
    "complexity=1;deliberation=1;tier=reasoning;frustration=0",
  )
  // Unresolved answers say nothing; tool guidance alone still does.
  expect(Intelligence.routerHint(scored(3, 3, 0.59), undefined)).toBeUndefined()
  expect(Intelligence.routerHint(scored(3, 3, 0.59), tools)).toBe("needs_tool=true")
  expect(Intelligence.routerHint({ ...scored(3, 3), decision: "unavailable" }, undefined)).toBeUndefined()
  expect(Intelligence.routerHint(undefined, undefined)).toBeUndefined()
  for (const complexity of [0, 0.5, 0.74, 0.75, 1, 1.5, 2, 2.25, 2.999999, 3])
    for (const consequence of [0, 1, 3]) {
      const hint = Intelligence.routerHint(scored(complexity, consequence), tools)
      expect(hint === undefined || ProviderRouter.validHint(hint)).toBe(true)
    }
})

test("the RedRouter hint carries the reasoning signals: stall, the user's feedback and frustration", () => {
  const base = classification({ score: 0, confidence: 1 }, { choice: "none", confidence: 1 })
  const judged = (choice: string, confidence: number, frustration: number) =>
    ({
      ...base,
      answers: {
        ...base.answers,
        frustration: { ...base.answers.frustration!, score: frustration } as (typeof base.answers)[string],
        user_feedback: {
          type: "choice",
          choice,
          confidence,
          probabilities: { [choice]: confidence, neutral: 1 - confidence },
        },
      },
    }) as typeof Evaluation.Type

  expect(Intelligence.routerHint(judged("corrects", 0.9, 2), undefined, { stall: true })).toBe(
    "complexity=0.333333;deliberation=0.333333;tier=medium;stall=true;feedback=corrects;frustration=0.666667",
  )
  // Unresolved feedback is left out; stall is said only when the caller knows it.
  expect(Intelligence.routerHint(judged("rejects", 0.5, 0), undefined)).toBe(
    "complexity=0.333333;deliberation=0.333333;tier=medium;frustration=0",
  )
  expect(Intelligence.routerHint(undefined, undefined, { stall: false })).toBe("stall=false")
  expect(Intelligence.routerHint(judged("sarcastic", 0.9, 0), undefined)).not.toContain("feedback")

  expect(Intelligence.effortAssessment(judged("agrees", 0.9, 3))).toEqual({
    complexity: 1 / 3,
    consequence: 1 / 3,
    impact: 0,
    frustration: 1,
    mustClarify: 0.05,
    feedback: "agrees",
  })
  expect(Intelligence.effortAssessment(undefined)).toBeUndefined()
  expect(Intelligence.effortAssessment({ ...base, decision: "unavailable" })).toBeUndefined()

  expect(Intelligence.promptContext(judged("rejects", 0.8, 1))).toContain(
    "Feedback on the previous turn: rejects (confidence 0.80)",
  )
  // Evaluations made before the question existed still render.
  expect(Intelligence.promptContext(base)).not.toContain("Feedback on the previous turn")
})

test("clarification policy permits inspection under uncertainty and never grants external authorization", () => {
  expect(
    Intelligence.promptContext(classification({ score: 0, confidence: 1 }, { choice: "none", confidence: 1 }, 0.8)),
  ).toContain("ask the user before dependent work")
  expect(
    Intelligence.promptContext(classification({ score: 0, confidence: 1 }, { choice: "none", confidence: 1 }, 0.5)),
  ).toContain("continue safe inspection, but avoid consequential action until resolved")
  expect(
    Intelligence.promptContext(classification({ score: 0, confidence: 1 }, { choice: "none", confidence: 1 }, 0.2)),
  ).toContain("proceed without clarification")
  expect(
    Intelligence.promptContext(classification({ score: 0, confidence: 1 }, { choice: "none", confidence: 1 })),
  ).toContain("Authorization for external or destructive actions comes from conversation history")
})

test("global setup survives reload, leaves credentials out of public settings, and defaults to disabled", async () => {
  await using dir = await tmpdir()
  await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* Intelligence.make(dir.path, credentials)
      expect(yield* service.read()).toEqual(Intelligence.defaults)
      yield* service.save({ settings: { enabled: false, onboarding: "deferred" } })
      const reloaded = yield* Intelligence.make(dir.path, credentials)
      expect((yield* reloaded.read()).onboarding).toBe("deferred")
      const result = yield* service.save({ settings: { enabled: true, onboarding: "completed" } }).pipe(Effect.result)
      expect(result._tag).toBe("Failure")
      expect((yield* service.read()).enabled).toBe(false)
      const single = yield* service.save({ settings: { enabled: true, reasoning: "single", onboarding: "completed" } })
      expect(single.reasoning).toBe("single")
      expect(
        yield* service.evaluate({ sessionID: "session", operation: "todos", sources: "source", questions }),
      ).toBeUndefined()
    }),
  )
})

test("native HTTP evaluation preserves real candidates, omits absent ones, and fails closed", async () => {
  await using dir = await tmpdir()
  const calls: unknown[] = []
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      calls.push(await request.json())
      if (calls.length === 1) return Response.json(response(0.02))
      if (calls.length === 2) return Response.json({ ...response(0), answers: {} })
      return Response.json({
        model: "jev-1.13.0",
        answers: {
          route: {
            type: "choice",
            choice: "local_change",
            confidence: 1,
            probabilities: { local_change: 1 },
          },
        },
        usage: { input_tokens: 20, output_tokens: 2 },
      })
    },
  })
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* Intelligence.make(dir.path, credentials)
        yield* service.save({
          settings: {
            enabled: true,
            reasoning: "dual",
            onboarding: "completed",
            principal: { id: Model.ID.make("main"), providerID: Provider.ID.make("test") },
            evaluator: { transport: "red-router", baseURL: `${server.url}v1`, model: "jev-1.13.0" },
          },
        })
        const input = {
          sessionID: "session",
          operation: "todos" as const,
          sources: { id: "request-1", text: "Preserve filters" },
          candidate: { criterion: "Filter selection survives pagination" },
          questions,
        }
        const accepted = yield* service.evaluate(input)
        expect(accepted?.decision).toBe("accepted")
        expect(accepted?.evaluator).toEqual({
          transport: "red-router",
          baseURL: `${server.url}v1`,
          model: "jev-1.13.0",
        })
        expect(calls[0]).toMatchObject({
          model: "jev-1.13.0",
          state: { sources: input.sources, candidate: input.candidate },
          questions,
        })
        const unavailable = yield* service.evaluate({ ...input, candidate: { criterion: "Changed" } })
        expect(unavailable?.decision).toBe("unavailable")
        expect(yield* Intelligence.requireAccepted(unavailable).pipe(Effect.result)).toMatchObject({ _tag: "Failure" })
        const classified = yield* service.evaluate({
          sessionID: "session",
          operation: "prompt_classification",
          kind: "classification",
          sources: { text: "Fix the crash" },
          questions: {
            route: {
              type: "choice",
              instructions: "What work is requested?",
              criteria: { local_change: "Change local files", answer: "Answer only" },
            },
          },
        })
        expect(classified?.decision).toBe("accepted")
        expect(calls[2]).toMatchObject({ state: { sources: { text: "Fix the crash" } } })
        expect(calls[2]).not.toHaveProperty("state.candidate")
        expect(yield* service.history("session")).toHaveLength(3)
        const files = yield* Effect.promise(() => fs.readdir(path.join(dir.path, "evaluations")))
        expect(files).toHaveLength(3)
        expect(files.every((file) => file.endsWith(".json.gz"))).toBe(true)
        expect(
          Array.from(
            (yield* Effect.promise(() => fs.readFile(path.join(dir.path, "evaluations", files[0]!)))).subarray(0, 2),
          ),
        ).toEqual([0x1f, 0x8b])
        expect(yield* service.history("different-session")).toHaveLength(0)
      }),
    )
  } finally {
    server.stop(true)
  }
})

test("database history preserves typed answers independently of compressed artifacts", async () => {
  await using dir = await tmpdir()
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* EffectDrizzleSqlite.makeWithDefaults()
      yield* DatabaseMigration.apply(db)
      yield* db.insert(ProjectTable).values({
        id: Project.ID.global,
        worktree: AbsolutePath.make("/project"),
        sandboxes: [],
      })
      const sessionID = SessionSchema.ID.make("ses_intelligence_database")
      yield* db.insert(SessionTable).values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: "intelligence",
        directory: "/project",
        title: "intelligence",
        version: "test",
      })
      const fetcher: typeof fetch = Object.assign(() => Promise.resolve(Response.json(response(0.02))), {
        preconnect() {},
      })
      const service = yield* Intelligence.make(dir.path, credentials, fetcher, {}, db)
      yield* service.save({
        settings: {
          enabled: true,
          reasoning: "dual",
          onboarding: "completed",
          principal: { id: Model.ID.make("main"), providerID: Provider.ID.make("test") },
          evaluator: { transport: "typesafe", baseURL: "https://api.typesafe.ai/v1", model: "jev-1.13.0" },
        },
      })
      yield* service.evaluate({
        sessionID,
        operation: "todos",
        sources: "request",
        candidate: "candidate",
        questions,
      })
      const history = yield* service.history(sessionID)
      expect(history).toHaveLength(1)
      expect(history[0]?.answers.omitted).toEqual({ type: "noul", noul: 0.02 })
      expect(history[0]?.operation).toBe("todos")
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )
})

test("disabled mode makes no provider calls; oversized sources cannot be silently approved", async () => {
  await using dir = await tmpdir()
  await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* Intelligence.make(dir.path, credentials)
      const input = {
        sessionID: "session",
        operation: "compaction" as const,
        sources: "x".repeat(80001),
        candidate: "summary",
        questions,
      }
      expect(yield* service.evaluate(input)).toBeUndefined()
      yield* service.save({
        settings: {
          enabled: true,
          reasoning: "dual",
          onboarding: "completed",
          principal: { id: Model.ID.make("main"), providerID: Provider.ID.make("test") },
          evaluator: { transport: "typesafe", baseURL: "https://invalid.example/v1", model: "jev-1.13.0" },
        },
      })
      expect((yield* service.evaluate(input))?.decision).toBe("unavailable")
    }),
  )
})

test("SQLite persists candidate-free classifications and retries unavailable evaluations", async () => {
  await using dir = await tmpdir()
  let unavailable = true
  const server = Bun.serve({
    port: 0,
    fetch: () =>
      unavailable
        ? new Response("unavailable", { status: 503 })
        : Response.json({
            model: "jev-test",
            answers: { route: { type: "choice", choice: "answer", confidence: 1, probabilities: { answer: 1 } } },
            usage: { input_tokens: 12, output_tokens: 1 },
          }),
  })
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* EffectDrizzleSqlite.makeWithDefaults()
        yield* DatabaseMigration.apply(db)
        yield* db
          .insert(ProjectTable)
          .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        const sessionID = SessionSchema.ID.make("ses_intelligence_classification")
        yield* db.insert(SessionTable).values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "classification",
          directory: "/project",
          title: "classification",
          version: "test",
        })
        const service = yield* Intelligence.make(dir.path, credentials, fetch, {}, db)
        yield* service.save({
          settings: {
            enabled: true,
            reasoning: "dual",
            onboarding: "completed",
            principal: { id: Model.ID.make("main"), providerID: Provider.ID.make("test") },
            evaluator: { transport: "red-router", baseURL: `${server.url}v1`, model: "jev-test" },
          },
        })
        const input: Intelligence.EvaluationInput = {
          sessionID,
          operation: "prompt_classification",
          kind: "classification",
          sources: { text: "Explain this code" },
          questions: { route: { type: "choice", instructions: "Choose", criteria: { answer: "Explain" } } },
        }
        const failure = yield* service.evaluate(input)
        expect(failure?.decision).toBe("unavailable")
        expect(failure?.issues.join(" ")).toContain("503")
        unavailable = false
        const success = yield* service.evaluate(input)
        expect(success?.decision).toBe("accepted")
        expect(success?.fingerprint).toBe(failure?.fingerprint)
        expect(success?.id).not.toBe(failure?.id)
        const history = yield* service.history(sessionID)
        expect(history).toHaveLength(2)
        expect(history.find((entry) => entry.id === success?.id)?.answers.route).toMatchObject({
          type: "choice",
          choice: "answer",
        })
        expect((yield* service.evaluate(input))?.id).toBe(success?.id)
      }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
    )
  } finally {
    server.stop(true)
  }
})

test("malformed configuration is visible and never silently resets enabled evaluation", async () => {
  await using dir = await tmpdir()
  await fs.writeFile(path.join(dir.path, "intelligence.json"), "broken")
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* Intelligence.make(dir.path, credentials)
      return yield* service.read().pipe(Effect.result)
    }),
  )
  expect(result._tag).toBe("Failure")
})

test("identical evaluations are reused while a changed source forces a new request", async () => {
  await using dir = await tmpdir()
  let calls = 0
  const server = Bun.serve({
    port: 0,
    fetch: () => {
      calls++
      return Response.json(response(0.01))
    },
  })
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* Intelligence.make(dir.path, credentials)
        yield* service.save({
          settings: {
            enabled: true,
            reasoning: "dual",
            onboarding: "completed",
            principal: { id: Model.ID.make("main"), providerID: Provider.ID.make("test") },
            evaluator: { transport: "red-router", baseURL: `${server.url}v1`, model: "jev-1.13.0" },
          },
        })
        const input = {
          sessionID: "session",
          operation: "plan" as const,
          sources: "revision 1",
          candidate: "plan",
          questions,
        }
        const first = yield* service.evaluate(input)
        expect((yield* service.evaluate(input))?.id).toBe(first?.id)
        expect(calls).toBe(1)
        yield* service.evaluate({ ...input, sources: "revision 2" })
        expect(calls).toBe(2)
      }),
    )
  } finally {
    server.stop(true)
  }
})

test("large checkpoints inspect every source batch and retain a rejection from any batch", async () => {
  await using dir = await tmpdir()
  let calls = 0
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const body = await request.text()
      calls++
      return Response.json(response(body.includes("MISSING_REQUIREMENT") ? 0.99 : 0.01))
    },
  })
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* Intelligence.make(dir.path, credentials)
        yield* service.save({
          settings: {
            enabled: true,
            reasoning: "dual",
            onboarding: "completed",
            principal: { id: Model.ID.make("main"), providerID: Provider.ID.make("test") },
            evaluator: { transport: "red-router", baseURL: `${server.url}v1`, model: "jev-1.13.0" },
          },
        })
        const result = yield* service.evaluate({
          sessionID: "session",
          operation: "compaction",
          sources: ["a".repeat(85000), "MISSING_REQUIREMENT"],
          candidate: "checkpoint",
          questions,
        })
        expect(result?.decision).toBe("needs_revision")
        expect(calls).toBeGreaterThan(2)
        expect(result?.usage.input_tokens).toBe(calls * 30)
      }),
    )
  } finally {
    server.stop(true)
  }
})

test("temporary overload retries once and missing catalog supports manual selection", async () => {
  await using dir = await tmpdir()
  let calls = 0
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      if (request.method === "GET") return new Response(null, { status: 404 })
      calls++
      return calls === 1 ? new Response(null, { status: 529 }) : Response.json(response(0.01))
    },
  })
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* Intelligence.make(dir.path, credentials)
        const evaluator = { transport: "red-router" as const, baseURL: `${server.url}v1`, model: "jev-1.13.0" }
        expect(yield* service.discover({ evaluator })).toEqual({ models: [], manual: true })
        yield* service.save({
          settings: {
            enabled: true,
            reasoning: "dual",
            onboarding: "completed",
            principal: { id: Model.ID.make("main"), providerID: Provider.ID.make("test") },
            evaluator,
          },
        })
        expect(
          (yield* service.evaluate({
            sessionID: "session",
            operation: "todos",
            sources: "source",
            candidate: "task",
            questions,
          }))?.decision,
        ).toBe("accepted")
        expect(calls).toBe(2)
      }),
    )
  } finally {
    server.stop(true)
  }
})

test("invalid evaluator URLs fail without replacing global settings", async () => {
  await using dir = await tmpdir()
  await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* Intelligence.make(dir.path, credentials)
      for (const baseURL of ["not a URL", "file:///tmp/key", "https://user:secret@example.test/v1"]) {
        const evaluator = { transport: "typesafe" as const, baseURL, model: "jev-1.13.0" }
        const saved = yield* service
          .save({ settings: { enabled: false, onboarding: "completed", evaluator } })
          .pipe(Effect.result)
        expect(saved._tag).toBe("Failure")
        expect((yield* service.probe({ evaluator })).ok).toBe(false)
        expect(yield* service.read()).toEqual(Intelligence.defaults)
      }
    }),
  )
})

test("System One probe reports actionable authentication and model response failures", async () => {
  await using dir = await tmpdir()
  const evaluator = {
    transport: "openrouter" as const,
    baseURL: "https://openrouter.ai/api/alpha",
    model: "typesafe/jev-1.13",
  }
  const unauthorized = await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* Intelligence.make(
        dir.path,
        credentials,
        Object.assign(() => Promise.resolve(new Response(null, { status: 401 })), { preconnect: fetch.preconnect }),
      )
      return yield* service.probe({ evaluator, apiKey: "invalid" })
    }),
  )
  expect(unauthorized).toEqual({
    ok: false,
    message: "System One authentication failed (HTTP 401). Check the API key for openrouter.",
  })

  const malformed = await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* Intelligence.make(
        dir.path,
        credentials,
        Object.assign(() => Promise.resolve(Response.json({ model: evaluator.model, answers: {}, usage: {} })), {
          preconnect: fetch.preconnect,
        }),
      )
      return yield* service.probe({ evaluator, apiKey: "valid" })
    }),
  )
  expect(malformed.ok).toBe(false)
  expect(malformed.message).toContain("System One connection failed:")
})

test("stored evaluator credentials cannot be redirected to another API origin", async () => {
  await using dir = await tmpdir()
  let calls = 0
  const server = Bun.serve({
    port: 0,
    fetch: () => {
      calls++
      return Response.json(response(0.01))
    },
  })
  try {
    const credential = new Credential.Info({
      id: Credential.ID.create(),
      integrationID: Integration.ID.make("intelligence:typesafe"),
      label: "TypeSafe",
      value: {
        type: "key",
        key: "must-not-leak",
        metadata: {
          intelligenceTransport: "typesafe",
          intelligenceBaseURL: "https://api.typesafe.ai/v1",
        },
      },
    })
    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* Intelligence.make(dir.path, {
          get: () => Effect.succeed(credential),
          list: () => Effect.succeed([]),
          create: () => Effect.die("unused"),
        })
        const evaluator = {
          transport: "typesafe" as const,
          baseURL: `${server.url}v1`,
          model: "jev-1.13.0",
          credentialID: credential.id,
        }
        const saved = yield* service
          .save({ settings: { enabled: false, onboarding: "completed", evaluator } })
          .pipe(Effect.result)
        expect(saved._tag).toBe("Failure")
        expect((yield* service.probe({ evaluator })).ok).toBe(false)
        expect(calls).toBe(0)
        expect(yield* service.read()).toEqual(Intelligence.defaults)
      }),
    )
  } finally {
    server.stop(true)
  }
})

test("Zen onboarding offers free Jev without changing existing defaults or accepting it as a generative role", async () => {
  expect(Intelligence.evaluatorPreset()).toEqual({
    transport: "opencode-zen",
    baseURL: "https://opencode.ai/zen/v1",
    model: "jev-1.13-free",
  })
  expect(Intelligence.evaluatorPreset("typesafe").model).toBe("jev-1.13.0")
  expect(Intelligence.evaluatorPreset("openrouter")).toEqual({
    transport: "openrouter",
    baseURL: "https://openrouter.ai/api/alpha",
    model: "typesafe/jev-1.13",
  })
  expect(Intelligence.evaluatorPreset("cloudflare-ai-gateway").model).toBe("typesafe/jev")
  expect(Intelligence.evaluatorPreset("vercel").model).toBe("typesafe-ai/jev")
  expect(Intelligence.evaluatorPreset("vivgrid").model).toBe("jev")
  expect(Intelligence.evaluatorPreset("nano-gpt").model).toBe("typesafe/jev-latest")
  expect(Intelligence.defaults).toEqual({ enabled: false, onboarding: "pending" })
  expect(Intelligence.isJev("typesafe-ai/jev")).toBe(true)
  expect(Intelligence.isJev("openrouter/typesafe/jev-1.13")).toBe(true)
  expect(Intelligence.isJev("jev-1.13-free")).toBe(true)
  expect(Intelligence.isJev("gpt-5")).toBe(false)
  await using dir = await tmpdir()
  await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* Intelligence.make(dir.path, credentials)
      const settings = {
        enabled: false,
        onboarding: "completed" as const,
        evaluator: Intelligence.evaluatorPreset("typesafe"),
      }
      yield* service.save({ settings })
      expect(yield* service.read()).toEqual(settings)
      const result = yield* service
        .save({
          settings: {
            ...settings,
            enabled: true,
            principal: { id: Model.ID.make("jev-1.13-free"), providerID: Provider.ID.make("opencode") },
          },
        })
        .pipe(Effect.result)
      expect(result._tag).toBe("Failure")
      expect(yield* service.read()).toEqual(settings)
    }),
  )
})

test("System One onboarding lists configured catalog providers first", async () => {
  await using dir = await tmpdir()
  const openrouter = new Credential.Info({
    id: Credential.ID.create(),
    integrationID: Integration.ID.make("openrouter"),
    label: "OpenRouter",
    value: { type: "key", key: "fixture" },
  })
  const workers = new Credential.Info({
    id: Credential.ID.create(),
    integrationID: Integration.ID.make("cloudflare-workers-ai"),
    label: "Cloudflare Workers AI",
    value: { type: "key", key: "workers-fixture", metadata: { accountId: "account" } },
  })
  const providers = ["opencode", "openrouter", "cloudflare-ai-gateway", "vercel", "vivgrid", "nano-gpt"]
  const catalog = Object.fromEntries(providers.map((id) => [id, { id, name: id, env: [], models: {} }]))
  const service = await Effect.runPromise(
    Intelligence.make(
      dir.path,
      {
        get: (id) => Effect.succeed(id === openrouter.id ? openrouter : id === workers.id ? workers : undefined),
        list: (id) =>
          Effect.succeed(
            id === openrouter.integrationID ? [openrouter] : id === workers.integrationID ? [workers] : [],
          ),
        create: () => Effect.die("unused"),
      },
      fetch,
      catalog,
    ),
  )
  const options = await Effect.runPromise(service.options())
  expect(options[0]).toMatchObject({
    name: "openrouter",
    configured: true,
    evaluator: { transport: "openrouter", model: "typesafe/jev-1.13", credentialID: openrouter.id },
  })
  expect(options).toContainEqual(
    expect.objectContaining({
      configured: true,
      evaluator: expect.objectContaining({
        transport: "cloudflare-ai-gateway",
        credentialID: workers.id,
      }),
    }),
  )
  expect(options.map((option) => option.evaluator.transport)).toEqual(
    expect.arrayContaining(["opencode-zen", "openrouter", "typesafe", "red-router", "vercel", "vivgrid", "nano-gpt"]),
  )
})

test("Cloudflare, Vercel and OpenRouter use their native System One endpoints", async () => {
  await using dir = await tmpdir()
  const calls: { url: URL; headers: Headers; body: unknown }[] = []
  const fetcher: typeof fetch = Object.assign(
    async (request: string | URL | Request, init?: RequestInit) => {
      const url = new URL(request instanceof Request ? request.url : request)
      const headers = new Headers(init?.headers)
      const body: unknown = JSON.parse(String(init?.body))
      calls.push({ url, headers, body })
      if (url.pathname.endsWith("/evaluation-model"))
        return Response.json({
          answers: { check: { type: "boolean", probability: 0.99 } },
          usage: { inputTokens: 8, outputTokens: 1 },
        })
      return Response.json({
        model: "jev-1.13.0",
        answers: { check: { type: "noul", noul: 0.99 } },
        usage: { input_tokens: 8, output_tokens: 1 },
      })
    },
    { preconnect: fetch.preconnect },
  )
  const cloudflare = new Credential.Info({
    id: Credential.ID.create(),
    integrationID: Integration.ID.make("cloudflare-ai-gateway"),
    label: "Cloudflare",
    value: { type: "key", key: "cloudflare-key", metadata: { accountId: "account", gatewayId: "gateway" } },
  })
  const workers = new Credential.Info({
    id: Credential.ID.create(),
    integrationID: Integration.ID.make("cloudflare-workers-ai"),
    label: "Cloudflare Workers AI",
    value: { type: "key", key: "workers-key", metadata: { accountId: "workers-account" } },
  })
  const service = await Effect.runPromise(
    Intelligence.make(
      dir.path,
      {
        get: (id) => Effect.succeed(id === cloudflare.id ? cloudflare : id === workers.id ? workers : undefined),
        list: () => Effect.succeed([]),
        create: () => Effect.die("unused"),
      },
      fetcher,
    ),
  )
  expect(
    (
      await Effect.runPromise(
        service.probe({
          evaluator: { ...Intelligence.evaluatorPreset("cloudflare-ai-gateway"), credentialID: cloudflare.id },
        }),
      )
    ).ok,
  ).toBe(true)
  expect(
    (
      await Effect.runPromise(
        service.probe({
          evaluator: { ...Intelligence.evaluatorPreset("cloudflare-ai-gateway"), credentialID: workers.id },
        }),
      )
    ).ok,
  ).toBe(true)
  expect(
    (
      await Effect.runPromise(
        service.probe({ evaluator: Intelligence.evaluatorPreset("vercel"), apiKey: "vercel-key" }),
      )
    ).ok,
  ).toBe(true)
  expect(
    (
      await Effect.runPromise(
        service.probe({ evaluator: Intelligence.evaluatorPreset("openrouter"), apiKey: "openrouter-key" }),
      )
    ).ok,
  ).toBe(true)
  expect(calls[0].url.pathname).toBe("/client/v4/accounts/account/ai/run")
  expect(calls[0].headers.get("cf-aig-gateway-id")).toBe("gateway")
  expect(calls[0].body).toMatchObject({ model: "typesafe/jev", input: { questions: { check: { type: "noul" } } } })
  expect(calls[1].url.pathname).toBe("/client/v4/accounts/workers-account/ai/run")
  expect(calls[1].headers.get("cf-aig-gateway-id")).toBeNull()
  expect(calls[2].url.pathname).toBe("/v4/ai/evaluation-model")
  expect(calls[2].headers.get("ai-model-id")).toBe("typesafe-ai/jev")
  expect(calls[2].body).toMatchObject({ questions: { check: { type: "boolean" } } })
  expect(calls[3].url.pathname).toBe("/api/alpha/decisions")
  expect(calls[3].headers.get("authorization")).toBe("Bearer openrouter-key")
  expect(calls[3].body).toMatchObject({ model: "typesafe/jev-1.13", questions: { check: { type: "noul" } } })
})

test("generic System One discovery excludes chat models and accepts routed evaluator IDs", async () => {
  await using dir = await tmpdir()
  const server = Bun.serve({
    port: 0,
    fetch: () =>
      Response.json({
        data: [{ id: "gpt-5" }, { id: "openrouter/typesafe/jev-1.13" }, { id: "typesafe-ai/jev" }],
      }),
  })
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* Intelligence.make(dir.path, credentials)
        const evaluator = {
          transport: "typesafe" as const,
          baseURL: `${server.url}v1`,
          model: "jev-1.13.0",
        }
        expect((yield* service.discover({ evaluator })).models.map((model) => model.id)).toEqual([
          "openrouter/typesafe/jev-1.13",
          "typesafe-ai/jev",
        ])
      }),
    )
  } finally {
    server.stop(true)
  }
})

test("Zen discovery excludes chat models and never falls back from free to paid Jev", async () => {
  await using dir = await tmpdir()
  let available = true
  const models: string[] = []
  const authorizations: (string | null)[] = []
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      if (new URL(request.url).pathname === "/v1/models")
        return Response.json({
          data: [{ id: "gpt-5" }, { id: "jev-1.13" }, ...(available ? [{ id: "jev-1.13-free" }] : [])],
        })
      const body = await request.json()
      models.push(body.model)
      authorizations.push(request.headers.get("authorization"))
      if (!available) return new Response("Free model unavailable", { status: 404 })
      return Response.json({
        model: body.model,
        answers: { check: { type: "noul", noul: 0.99 } },
        usage: { input_tokens: 10, output_tokens: 1 },
      })
    },
  })
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* Intelligence.make(dir.path, credentials)
        const evaluator = { transport: "opencode-zen" as const, baseURL: `${server.url}v1`, model: "jev-1.13-free" }
        expect((yield* service.discover({ evaluator })).models.map((model) => model.id)).toEqual([
          "jev-1.13",
          "jev-1.13-free",
        ])
        expect((yield* service.probe({ evaluator, apiKey: "fixture-key" })).ok).toBe(true)
        expect(authorizations).toEqual(["Bearer fixture-key"])
        yield* service.save({
          settings: {
            enabled: true,
            reasoning: "dual",
            onboarding: "completed",
            evaluator,
            principal: { id: Model.ID.make("main"), providerID: Provider.ID.make("test") },
          },
        })
        available = false
        expect((yield* service.probe({ evaluator })).ok).toBe(false)
        expect(models).toEqual(["jev-1.13-free"])
        const evaluation = yield* service.evaluate({
          sessionID: "session",
          operation: "todos",
          sources: "Keep filters",
          candidate: "Reset filters",
          questions,
        })
        expect(evaluation?.decision).toBe("unavailable")
        expect(models).toEqual(["jev-1.13-free", "jev-1.13-free"])
        expect((yield* service.read()).evaluator).toEqual(evaluator)
      }),
    )
  } finally {
    server.stop(true)
  }
})

test("official Zen reuses an existing OpenCode connection and otherwise uses its public free access", async () => {
  await using dir = await tmpdir()
  const authorizations: (string | null)[] = []
  const fetcher: typeof fetch = Object.assign(
    async (request: string | URL | Request, init?: RequestInit) => {
      const url = new URL(request instanceof Request ? request.url : request)
      const headers = new Headers(init?.headers)
      authorizations.push(headers.get("authorization"))
      if (url.pathname.endsWith("/models")) return Response.json({ data: [{ id: "jev-1.13-free" }] })
      return Response.json({
        model: "jev-1.13-free",
        answers: { check: { type: "noul", noul: 0.99 } },
        usage: { input_tokens: 10, output_tokens: 1 },
      })
    },
    { preconnect: fetch.preconnect },
  )
  const connected = new Credential.Info({
    id: Credential.ID.create(),
    integrationID: Integration.ID.make("opencode"),
    label: "OpenCode",
    value: { type: "key", key: "existing-zen-key" },
  })
  await Effect.runPromise(
    Effect.gen(function* () {
      const evaluator = Intelligence.evaluatorPreset()
      const withConnection = yield* Intelligence.make(
        dir.path,
        {
          get: () => Effect.succeed(undefined),
          list: () => Effect.succeed([connected]),
          create: () => Effect.die("unused"),
        },
        fetcher,
      )
      expect((yield* withConnection.probe({ evaluator })).ok).toBe(true)
      const publicAccess = yield* Intelligence.make(dir.path, credentials, fetcher)
      expect((yield* publicAccess.probe({ evaluator })).ok).toBe(true)
      expect(authorizations).toEqual([
        "Bearer existing-zen-key",
        "Bearer existing-zen-key",
        "Bearer public",
        "Bearer public",
      ])
    }),
  )
})

test("a connected RedRouter serving System One is offered with the provider key, only for its address", async () => {
  await using dir = await tmpdir()
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      if (request.headers.get("authorization") !== "Bearer router-key") return new Response("refused", { status: 401 })
      const path = new URL(request.url).pathname
      if (path === "/v1/capabilities")
        return Response.json({
          product: "red-router",
          version: "3.2.0",
          systemone: { endpoint: "/v1/systemone", available: true, models: ["jev/jev-latest"] },
        })
      if (path === "/v1/systemone") return Response.json(response(0.02))
      return new Response("not found", { status: 404 })
    },
  })
  try {
    const baseURL = `http://localhost:${server.port}/v1`
    const provider = new Credential.Info({
      id: Credential.ID.create(),
      integrationID: Integration.ID.make("red-router"),
      label: "Provider connection",
      value: { type: "key", key: "router-key", metadata: { baseURL } },
    })
    const service = await Effect.runPromise(
      Intelligence.make(
        dir.path,
        {
          get: (id) => Effect.succeed(id === provider.id ? provider : undefined),
          list: (id) => Effect.succeed(id === provider.integrationID ? [provider] : []),
          create: () => Effect.die("unused"),
        },
        fetch,
      ),
    )
    const router = await Effect.runPromise(service.router())
    expect(router).toMatchObject({
      providerID: "red-router",
      baseURL,
      detection: { kind: "red-router", version: "3.2.0", systemOne: { available: true } },
      evaluator: { transport: "red-router", baseURL, model: "jev/jev-latest", credentialID: provider.id },
    })
    const options = await Effect.runPromise(service.options())
    expect(options.find((option) => option.evaluator.transport === "red-router")?.evaluator).toMatchObject({
      baseURL,
      credentialID: provider.id,
    })
    // Either loopback name reaches the address the key was saved for.
    const loopback = { ...router!.evaluator!, baseURL: `http://127.0.0.1:${server.port}/v1` }
    expect(await Effect.runPromise(service.request(loopback, "systemone", { model: "jev/jev-latest" }))).toEqual(
      response(0.02),
    )
    const elsewhere = await Effect.runPromise(
      service.request({ ...loopback, baseURL: "http://127.0.0.1:9/v1" }, "systemone", {}).pipe(Effect.result),
    )
    expect(elsewhere._tag).toBe("Failure")
    if (elsewhere._tag === "Failure") expect(elsewhere.failure.message).toContain("does not belong")
  } finally {
    ProviderRouter.forget()
    await server.stop(true)
  }
})

test("a removed System One credential heals to the provider's current connection and persists", async () => {
  await using dir = await tmpdir()
  const keys: Array<string | null> = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      keys.push(request.headers.get("authorization"))
      return Response.json(response(0.02))
    },
  })
  try {
    const baseURL = `http://127.0.0.1:${server.port}/v1`
    // Reconnecting RedRouter saved its key under a new id; the settings still name the old one.
    const current = new Credential.Info({
      id: Credential.ID.create(),
      integrationID: Integration.ID.make("red-router"),
      label: "Provider connection",
      value: { type: "key", key: "router-key", metadata: { baseURL, router: "red-router" } },
    })
    const elsewhere = new Credential.Info({
      id: Credential.ID.create(),
      integrationID: Integration.ID.make("red-router"),
      label: "Provider connection",
      value: { type: "key", key: "other-key", metadata: { baseURL: "http://127.0.0.1:9/v1" } },
    })
    const evaluator = {
      transport: "red-router" as const,
      baseURL,
      model: "openrouter/typesafe/jev-1.13",
      credentialID: Credential.ID.make("cred_removed"),
    }
    await fs.writeFile(
      path.join(dir.path, "intelligence.json"),
      JSON.stringify({ enabled: true, reasoning: "dual", onboarding: "completed", evaluator }),
    )
    const serviceWith = (connections: Credential.Info[]) =>
      Effect.runPromise(
        Intelligence.make(
          dir.path,
          {
            get: (id) => Effect.succeed(connections.find((item) => item.id === id)),
            list: (id) => Effect.succeed(connections.filter((item) => item.integrationID === id)),
            create: () => Effect.die("unused"),
          },
          fetch,
        ),
      )

    // No connection at all: a distinct message that says what to do.
    const missing = await Effect.runPromise(
      (await serviceWith([])).request(evaluator, "systemone", { model: evaluator.model }).pipe(Effect.result),
    )
    expect(missing._tag).toBe("Failure")
    if (missing._tag === "Failure")
      expect(missing.failure.message).toBe("System One credential was removed; reconnect red-router in /setup")

    // A connection saved for another address is never adopted.
    const foreign = await Effect.runPromise(
      (await serviceWith([elsewhere])).request(evaluator, "systemone", {}).pipe(Effect.result),
    )
    expect(foreign._tag).toBe("Failure")
    if (foreign._tag === "Failure") expect(foreign.failure.message).toContain("System One credential was removed")
    expect(keys).toEqual([])

    const service = await serviceWith([current])
    expect(await Effect.runPromise(service.request(evaluator, "systemone", { model: evaluator.model }))).toEqual(
      response(0.02),
    )
    expect(keys).toEqual(["Bearer router-key"])
    expect((await Effect.runPromise(service.read())).evaluator?.credentialID).toBe(current.id)

    // An existing credential that belongs elsewhere is still refused, not healed.
    const mismatched = await Effect.runPromise(
      (await serviceWith([current, elsewhere]))
        .request({ ...evaluator, credentialID: elsewhere.id }, "systemone", {})
        .pipe(Effect.result),
    )
    expect(mismatched._tag).toBe("Failure")
    if (mismatched._tag === "Failure") expect(mismatched.failure.message).toContain("does not belong")
  } finally {
    await server.stop(true)
  }
})

test("no RedRouter is offered when the connected router does not answer as one", async () => {
  await using dir = await tmpdir()
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("not found", { status: 404 }) })
  try {
    const provider = new Credential.Info({
      id: Credential.ID.create(),
      integrationID: Integration.ID.make("red-router"),
      label: "Provider connection",
      value: { type: "key", key: "router-key", metadata: { baseURL: `http://127.0.0.1:${server.port}/v1` } },
    })
    const service = await Effect.runPromise(
      Intelligence.make(
        dir.path,
        {
          get: () => Effect.succeed(provider),
          list: (id) => Effect.succeed(id === provider.integrationID ? [provider] : []),
          create: () => Effect.die("unused"),
        },
        fetch,
      ),
    )
    expect(await Effect.runPromise(service.router())).toBeUndefined()
  } finally {
    ProviderRouter.forget()
    await server.stop(true)
  }
})

test("a RedRouter connected under another provider id is found by the router its key recorded", async () => {
  await using dir = await tmpdir()
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      if (request.headers.get("authorization") !== "Bearer work-key") return new Response("refused", { status: 401 })
      if (new URL(request.url).pathname === "/v1/capabilities")
        return Response.json({ product: "red-router", version: "3.4.0" })
      return new Response("not found", { status: 404 })
    },
  })
  try {
    const baseURL = `http://127.0.0.1:${server.port}/v1`
    const unrelated = new Credential.Info({
      id: Credential.ID.create(),
      integrationID: Integration.ID.make("local-llm"),
      label: "Provider connection",
      value: { type: "key", key: "other-key", metadata: { baseURL: "http://127.0.0.1:9/v1" } },
    })
    const provider = new Credential.Info({
      id: Credential.ID.create(),
      integrationID: Integration.ID.make("work-router"),
      label: "Provider connection",
      value: { type: "key", key: "work-key", metadata: { baseURL, router: "red-router" } },
    })
    const service = await Effect.runPromise(
      Intelligence.make(
        dir.path,
        {
          all: () => Effect.succeed([unrelated, provider]),
          get: (id) => Effect.succeed(id === provider.id ? provider : undefined),
          list: () => Effect.succeed([]),
          create: () => Effect.die("unused"),
        },
        fetch,
      ),
    )
    expect(await Effect.runPromise(service.router())).toMatchObject({
      providerID: "work-router",
      baseURL,
      detection: { kind: "red-router", version: "3.4.0" },
    })
  } finally {
    ProviderRouter.forget()
    await server.stop(true)
  }
})

test("a RedRouter advertising recommendations carries them and evaluates with its recommended System One model", async () => {
  await using dir = await tmpdir()
  const recommended = {
    default: {
      id: "cc/claude-opus-5-5",
      name: "Claude Opus 5.5",
      provider: { slug: "cc", name: "Claude Code" },
      reason: "Strongest connected coding model (claude-opus family, newest version).",
    },
    systemone: {
      id: "jev/jev-1.13",
      name: "Jev 1.13",
      provider: { slug: "jev", name: "Jev" },
      reason: "First JEV model served on /v1/systemone.",
    },
  }
  const catalogs: string[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      const path = new URL(request.url).pathname
      if (path === "/v1/capabilities")
        return Response.json({
          product: "red-router",
          version: "3.6.0",
          systemone: { available: true, models: ["jev/jev-latest", "jev/jev-1.13"] },
          catalog: { version: "cat-1", catalog_endpoint: "/v1/catalog", recommendations: true },
        })
      if (path === "/v1/catalog") {
        catalogs.push(request.headers.get("authorization") ?? "-")
        return Response.json({ version: "cat-1", groups: [], combos: [], recommended: { ...recommended, fast: null } })
      }
      return new Response("not found", { status: 404 })
    },
  })
  try {
    const baseURL = `http://127.0.0.1:${server.port}/v1`
    const provider = new Credential.Info({
      id: Credential.ID.create(),
      integrationID: Integration.ID.make("red-router"),
      label: "Provider connection",
      value: { type: "key", key: "router-key", metadata: { baseURL } },
    })
    const service = await Effect.runPromise(
      Intelligence.make(
        dir.path,
        {
          get: (id) => Effect.succeed(id === provider.id ? provider : undefined),
          list: (id) => Effect.succeed(id === provider.integrationID ? [provider] : []),
          create: () => Effect.die("unused"),
        },
        fetch,
      ),
    )
    const router = await Effect.runPromise(service.router())
    expect(router?.recommended).toEqual(recommended)
    expect(router?.evaluator?.model).toBe("jev/jev-1.13")
    // The catalog is read once per catalog version, with the provider's key.
    await Effect.runPromise(service.router())
    expect(catalogs).toEqual(["Bearer router-key"])
  } finally {
    ProviderRouter.forget()
    await server.stop(true)
  }
})

test("a RedRouter whose catalog fails is still offered, without recommendations", async () => {
  await using dir = await tmpdir()
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      const path = new URL(request.url).pathname
      if (path === "/v1/capabilities")
        return Response.json({
          product: "red-router",
          version: "3.6.0",
          systemone: { available: true, models: ["jev/jev-latest"] },
          catalog: { version: "cat-1", catalog_endpoint: "/v1/catalog", recommendations: true },
        })
      return new Response("unavailable", { status: 503 })
    },
  })
  try {
    const baseURL = `http://127.0.0.1:${server.port}/v1`
    const provider = new Credential.Info({
      id: Credential.ID.create(),
      integrationID: Integration.ID.make("red-router"),
      label: "Provider connection",
      value: { type: "key", key: "router-key", metadata: { baseURL } },
    })
    const service = await Effect.runPromise(
      Intelligence.make(
        dir.path,
        {
          get: (id) => Effect.succeed(id === provider.id ? provider : undefined),
          list: (id) => Effect.succeed(id === provider.integrationID ? [provider] : []),
          create: () => Effect.die("unused"),
        },
        fetch,
      ),
    )
    const router = await Effect.runPromise(service.router())
    expect(router?.detection.features).toContain("recommendations")
    expect(router?.recommended).toBeUndefined()
    expect(router?.evaluator?.model).toBe("jev/jev-latest")
  } finally {
    ProviderRouter.forget()
    await server.stop(true)
  }
})

const responseReview = (answers: Record<string, number>): typeof Evaluation.Type => {
  const decided = Intelligence.decide(
    Intelligence.questions(Object.fromEntries(Object.keys(answers).map((id) => [id, id]))),
    {
      model: "jev-test",
      answers: Object.fromEntries(Object.entries(answers).map(([id, noul]) => [id, { type: "noul" as const, noul }])),
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  )
  return {
    id: "review",
    fingerprint: "review",
    sessionID: "session",
    operation: "response_quality",
    kind: "gate",
    policy: Intelligence.POLICY,
    decision: decided.decision,
    model: "jev-test",
    answers: Object.fromEntries(Object.entries(answers).map(([id, noul]) => [id, { type: "noul" as const, noul }])),
    issues: decided.issues,
    created: 1,
    duration: 1,
    usage: { input_tokens: 1, output_tokens: 1 },
  }
}

test("a response review repairs only issues System One establishes", () => {
  // The answers jev-1.13 gave a greeting reply ("Hey! Test received loud and clear. What do you need?").
  const greeting = responseReview({ omission: 0.11, unsupported: 0.21, tool_evidence: 0.03, premature: 0.04 })
  expect(greeting.decision).toBe("inconclusive")
  expect(Intelligence.responseRepair(greeting, [])).toEqual({ repair: [], unresolved: [] })
  expect(Intelligence.responseRepair(responseReview({ omission: 0.6, writing: 0.2 }), [])).toEqual({
    repair: [],
    unresolved: [],
  })
  expect(Intelligence.responseRepair(responseReview({ omission: 0.95, writing: 0.2 }), [])).toEqual({
    repair: ["omission"],
    unresolved: ["omission"],
  })
  expect(Intelligence.responseRepair(undefined, [])).toEqual({ repair: [], unresolved: [] })
})

test("an issue already repaired this turn is not repaired again", () => {
  const again = responseReview({ omission: 0.95, writing: 0.9 })
  expect(Intelligence.responseRepair(again, ["omission"])).toEqual({
    repair: ["writing"],
    unresolved: ["omission", "writing"],
  })
  expect(Intelligence.responseRepair(again, ["omission", "writing"])).toEqual({
    repair: [],
    unresolved: ["omission", "writing"],
  })
})

test("the unsupported check asks about claimed work, not conversation, under the same keys", () => {
  expect(Object.keys(Intelligence.responseQuestions).toSorted()).toEqual([
    "omission",
    "premature",
    "tool_evidence",
    "unsupported",
    "writing",
    "writing_quality",
  ])
  const unsupported = Intelligence.responseQuestions.unsupported
  expect(unsupported?.type).toBe("noul")
  // A greeting that says it is working ("Olá! Funcionando.") is not a claim of performed work.
  expect(unsupported?.instructions).toContain("performed or verified work")
  expect(unsupported?.instructions).toContain("are not claims of work")
  expect(Intelligence.REPAIR_CONFIDENCE).toBe(0.75)
})

test("response checks follow the evidence a turn has", () => {
  expect(
    Intelligence.responseQuestionsFor({ tools: false, tasks: false, goal: false, route: "answer" }),
  ).toBeUndefined()
  const plain = Intelligence.responseQuestionsFor({ tools: false, tasks: false, goal: false, route: "uncertain" })
  expect(Object.keys(plain ?? {}).toSorted()).toEqual(["omission", "unsupported", "writing", "writing_quality"])
  expect(
    Object.keys(Intelligence.responseQuestionsFor({ tools: true, tasks: false, goal: false, route: "answer" }) ?? {}),
  ).toContain("tool_evidence")
  expect(Object.keys(Intelligence.responseQuestionsFor({ tools: false, tasks: false, goal: true }) ?? {})).toContain(
    "premature",
  )
  expect(Intelligence.workRoute(classification({ score: 2, confidence: 0.8 }, { choice: "none", confidence: 1 }))).toBe(
    "local_change",
  )
  expect(Intelligence.workRoute(undefined)).toBeUndefined()
})

test("a revision that changes nothing material is the same response in any script", () => {
  expect(Intelligence.sameResponse("Hey! Test received.", "hey — test received")).toBe(true)
  expect(
    Intelligence.sameResponse(
      "The build passes and the crash is fixed in the parser.",
      "The build passes, and the crash is fixed in the parser!",
    ),
  ).toBe(true)
  expect(
    Intelligence.sameResponse("テストを受け取りました。何をしますか？", "テストを受け取りました 何をしますか"),
  ).toBe(true)
  expect(
    Intelligence.sameResponse(
      "Hey! Test received loud and clear. What do you need?",
      "Copy that — no task was included, so there's nothing to run or verify yet. What would you like me to do?",
    ),
  ).toBe(false)
  expect(Intelligence.sameResponse("テストを受け取りました。", "ビルドは失敗しました。")).toBe(false)
})
