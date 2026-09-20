import { expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { Intelligence } from "../src/intelligence"
import { Credential } from "../src/credential"
import { Answer } from "@reddb-io/redcode-schema/intelligence"
import { Integration } from "@reddb-io/redcode-schema/integration"
import { Model } from "@reddb-io/redcode-schema/model"
import { Provider } from "@reddb-io/redcode-schema/provider"
import { tmpdir } from "./fixture/tmpdir"

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

test("experimental thresholds distinguish rejection from uncertainty without averaging failures", () => {
  expect(Intelligence.decide(questions, response(0.1)).decision).toBe("accepted")
  expect(Intelligence.decide(questions, response(0.5)).decision).toBe("inconclusive")
  expect(Intelligence.decide(questions, response(0.9)).decision).toBe("needs_revision")
  expect(() => Intelligence.decide(questions, { ...response(0), answers: {} })).toThrow()
  expect(() => Schema.decodeUnknownSync(Answer)(response(1.01).answers.omitted)).toThrow()
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

test("native HTTP evaluation persists candidate and source references and fails closed on incomplete responses", async () => {
  await using dir = await tmpdir()
  const calls: unknown[] = []
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      calls.push(await request.json())
      return Response.json(calls.length === 1 ? response(0.02) : { ...response(0), answers: {} })
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
        expect(yield* service.history("session")).toHaveLength(2)
        const files = yield* Effect.promise(() => fs.readdir(path.join(dir.path, "evaluations")))
        expect(files).toHaveLength(2)
        expect(yield* service.history("different-session")).toHaveLength(0)
      }),
    )
  } finally {
    server.stop(true)
  }
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
