import { expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@reddb-io/redcode-effect-drizzle-sqlite"
import fs from "node:fs/promises"
import path from "node:path"
import { Intelligence } from "../src/intelligence"
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
  ])
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
          onboarding: "completed",
          principal: { id: Model.ID.make("main"), providerID: Provider.ID.make("test") },
          evaluator: { transport: "typesafe", baseURL: "https://invalid.example/v1", model: "jev-1.13.0" },
        },
      })
      expect((yield* service.evaluate(input))?.decision).toBe("unavailable")
    }),
  )
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
      const service = yield* Intelligence.make(dir.path, credentials, () =>
        Promise.resolve(new Response(null, { status: 401 })),
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
      const service = yield* Intelligence.make(dir.path, credentials, () =>
        Promise.resolve(Response.json({ model: evaluator.model, answers: {}, usage: {} })),
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
  const providers = ["opencode", "openrouter", "cloudflare-ai-gateway", "vercel", "vivgrid", "nano-gpt"]
  const catalog = Object.fromEntries(providers.map((id) => [id, { id, name: id, env: [], models: {} }]))
  const service = await Effect.runPromise(
    Intelligence.make(
      dir.path,
      {
        get: (id) => Effect.succeed(id === openrouter.id ? openrouter : undefined),
        list: (id) => Effect.succeed(id === openrouter.integrationID ? [openrouter] : []),
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
  const service = await Effect.runPromise(
    Intelligence.make(
      dir.path,
      {
        get: (id) => Effect.succeed(id === cloudflare.id ? cloudflare : undefined),
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
  expect(calls[1].url.pathname).toBe("/v4/ai/evaluation-model")
  expect(calls[1].headers.get("ai-model-id")).toBe("typesafe-ai/jev")
  expect(calls[1].body).toMatchObject({ questions: { check: { type: "boolean" } } })
  expect(calls[2].url.pathname).toBe("/api/alpha/decisions")
  expect(calls[2].headers.get("authorization")).toBe("Bearer openrouter-key")
  expect(calls[2].body).toMatchObject({ model: "typesafe/jev-1.13", questions: { check: { type: "noul" } } })
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
