import { describe, expect, spyOn, test } from "bun:test"
import { Credential } from "@opencode/core/credential"
import { Intelligence } from "@opencode/core/intelligence"
import { credentialMatches, IntelligenceTransport } from "@opencode/core/intelligence/transport"
import { IntelligenceEvaluation } from "@opencode/core/intelligence/evaluation"
import { IntelligenceRouter } from "@opencode/core/intelligence/router"
import { RemoteCheck } from "@opencode/core/remote-check"
import { Integration } from "@opencode/schema/integration"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Schema } from "effect"
import { tempGlobalLayer } from "../fixture/global"
import { testEffect } from "../lib/effect"
import { withEnv } from "../fixture/env"

const it = testEffect(
  LayerNode.compile(LayerNode.group([Intelligence.node, IntelligenceTransport.node, Credential.node]), {
    replacements: [Global.node.replace(tempGlobalLayer)],
  }),
)

const serve = (fetch: (request: Request) => Response | Promise<Response>) =>
  Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch })),
    (server) => Effect.sync(() => server.stop(true)),
  )

const connect = (baseURL: string, label: string, key: string) =>
  Effect.gen(function* () {
    const credentials = yield* Credential.Service
    return yield* credentials.create({
      integrationID: Integration.ID.make("red-router"),
      label,
      value: Credential.Key.make({ type: "key", key, configuration: { baseURL } }),
    })
  })

describe("System One credential boundaries", () => {
  const transports = [
    "opencode-zen",
    "openrouter",
    "typesafe",
    "red-router",
    "cloudflare-ai-gateway",
    "vercel",
    "vivgrid",
    "nano-gpt",
  ] as const
  const environment = {
    OPENCODE_API_KEY: "ambient-zen",
    OPENROUTER_API_KEY: "ambient-openrouter",
    TYPESAFE_API_KEY: "ambient-typesafe",
    RED_ROUTER_API_KEY: "ambient-router",
    CLOUDFLARE_API_TOKEN: "ambient-cloudflare",
    CF_AIG_TOKEN: "ambient-gateway",
    CLOUDFLARE_ACCOUNT_ID: "ambient-account",
    CLOUDFLARE_GATEWAY_ID: "ambient-gateway-id",
    AI_GATEWAY_API_KEY: "ambient-vercel",
    VIVGRID_API_KEY: "ambient-vivgrid",
    NANO_GPT_API_KEY: "ambient-nano",
  }

  it.live("never offers or probes providers just because environment variables exist", () =>
    Effect.gen(function* () {
      const calls: string[] = []
      const server = yield* serve((request) => {
        calls.push(request.url)
        return Response.json({ product: "red-router" })
      })
      yield* withEnv({ ...environment, RED_ROUTER_BASE_URL: `${server.url.href}v1` }, () =>
        Effect.gen(function* () {
          const transport = yield* IntelligenceTransport.Service
          for (const id of transports) expect(yield* transport.options(id)).toEqual([])
          const intelligence = yield* Intelligence.Service
          const status = yield* intelligence.status()
          expect(status.evaluators).toEqual([])
          expect(status.router).toBeUndefined()
          expect(calls).toEqual([])
        }),
      )
    }),
  )

  it.live("never forwards ambient tokens or gateway headers to a selected endpoint", () =>
    withEnv(environment, () =>
      Effect.gen(function* () {
        const calls: Array<{ authorization: string | null; gateway: string | null }> = []
        const server = yield* serve((request) => {
          calls.push({
            authorization: request.headers.get("authorization"),
            gateway: request.headers.get("cf-aig-gateway-id"),
          })
          return Response.json({})
        })
        const transport = yield* IntelligenceTransport.Service
        for (const id of transports)
          yield* transport.request(
            { ...IntelligenceEvaluation.evaluatorPreset(id), baseURL: server.url.href },
            "models",
          )
        expect(calls).toEqual(transports.map(() => ({ authorization: null, gateway: null })))
      }),
    ),
  )

  it.live("keeps saved and explicitly supplied keys working without ambient routing", () =>
    withEnv(environment, () =>
      Effect.gen(function* () {
        const calls: Array<{ path: string; authorization: string | null; gateway: string | null }> = []
        const server = yield* serve((request) => {
          calls.push({
            path: new URL(request.url).pathname,
            authorization: request.headers.get("authorization"),
            gateway: request.headers.get("cf-aig-gateway-id"),
          })
          return Response.json({})
        })
        const credential = yield* connect(`${server.url.href}v1`, "Selected Router", "selected-router")
        const transport = yield* IntelligenceTransport.Service
        const evaluator = (yield* transport.options("red-router"))[0].evaluator
        expect(evaluator.credentialID).toBe(credential.id)
        yield* transport.request(evaluator, "models")
        yield* transport.request(evaluator, "models", undefined, "explicit-key")
        const credentials = yield* Credential.Service
        const cloudflare = yield* credentials.create({
          integrationID: Integration.ID.make("cloudflare-ai-gateway"),
          label: "Selected Cloudflare",
          value: Credential.Key.make({
            type: "key",
            key: "selected-cloudflare",
            configuration: {
              baseURL: server.url.href,
              accountId: "selected-account",
              gatewayId: "selected-gateway",
            },
            metadata: { accountId: "old-account", gatewayId: "old-gateway" },
          }),
        })
        yield* transport.request((yield* transport.options("cloudflare-ai-gateway"))[0].evaluator, "systemone", {
          model: "typesafe/jev",
          state: {},
          questions: {},
        })
        expect(calls).toEqual([
          { path: "/v1/models", authorization: "Bearer selected-router", gateway: null },
          { path: "/v1/models", authorization: "Bearer explicit-key", gateway: null },
          {
            path: "/accounts/selected-account/ai/run",
            authorization: "Bearer selected-cloudflare",
            gateway: "selected-gateway",
          },
        ])
        expect((yield* transport.options("cloudflare-ai-gateway"))[0].evaluator.credentialID).toBe(cloudflare.id)
      }),
    ),
  )

  it.live("does not replace missing Cloudflare account metadata with ambient configuration", () =>
    withEnv(environment, () =>
      Effect.gen(function* () {
        const calls: string[] = []
        const server = yield* serve((request) => {
          calls.push(request.url)
          return Response.json({})
        })
        const transport = yield* IntelligenceTransport.Service
        const result = yield* transport
          .request(
            { ...IntelligenceEvaluation.evaluatorPreset("cloudflare-ai-gateway"), baseURL: server.url.href },
            "systemone",
            { model: "typesafe/jev", state: {}, questions: {} },
            "explicit-key",
          )
          .pipe(Effect.flip)
        expect(result.message).toContain("Cloudflare Account ID is required")
        expect(calls).toEqual([])
      }),
    ),
  )

  it.live("does not send self-hosted Console credentials to the hosted Zen endpoint", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const transport = yield* IntelligenceTransport.Service
      for (const server of ["https://console.example", "https://opencode.ai/other", "https://user@opencode.ai/console"])
        for (const type of ["key", "oauth"] as const) {
          const credential = yield* credentials.create({
            integrationID: Integration.ID.make("opencode"),
            label: "Self-hosted Console",
            value:
              type === "key"
                ? Credential.Key.make({ type, key: "private-console", metadata: { server } })
                : Credential.OAuth.make({
                    type,
                    methodID: Integration.MethodID.make("device"),
                    access: "private-console",
                    refresh: "private-refresh",
                    expires: Date.now() + 60_000,
                    metadata: { server },
                  }),
          })
          expect(yield* transport.options("opencode-zen")).toEqual([])
          expect(credentialMatches(IntelligenceEvaluation.evaluatorPreset(), credential)).toBe(false)
          const result = yield* transport
            .request({ ...IntelligenceEvaluation.evaluatorPreset(), credentialID: credential.id }, "models")
            .pipe(Effect.flip)
          expect(result.message).toContain("does not belong")
          yield* credentials.remove(credential.id)
        }
      const hosted = yield* credentials.create({
        integrationID: Integration.ID.make("opencode"),
        label: "Hosted Console",
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("device"),
          access: "hosted-console",
          refresh: "hosted-refresh",
          expires: Date.now() + 60_000,
          metadata: { server: "https://opencode.ai/console/" },
        }),
      })
      expect((yield* transport.options("opencode-zen"))[0].evaluator.credentialID).toBe(hosted.id)
      expect(credentialMatches(IntelligenceEvaluation.evaluatorPreset(), hosted)).toBe(true)
    }),
  )

  it.live("uses only public access for an explicitly chosen Zen evaluator without a matching connection", () =>
    withEnv(environment, () =>
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        yield* credentials.create({
          integrationID: Integration.ID.make("opencode"),
          label: "Self-hosted Console",
          value: Credential.Key.make({
            type: "key",
            key: "private-console",
            metadata: { server: "https://console.example" },
          }),
        })
        const calls: Array<{ url: string; authorization: string | null }> = []
        // This endpoint is fixed to the real hosted service; intercept only its network boundary.
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            spyOn(RemoteCheck, "request").mockImplementation(async (url, init) => {
              calls.push({ url, authorization: new Headers(init.headers).get("authorization") })
              return Response.json({})
            }),
          ),
          (request) => Effect.sync(() => request.mockRestore()),
        )
        const transport = yield* IntelligenceTransport.Service
        yield* transport.request(IntelligenceEvaluation.evaluatorPreset(), "models")
        expect(calls).toEqual([{ url: "https://opencode.ai/zen/v1/models", authorization: "Bearer public" }])
      }),
    ),
  )
})

describe("connection-scoped System One discovery", () => {
  it.live("uses compatible canonical decision aliases only from the selected provider", () =>
    Effect.gen(function* () {
      const transport = yield* IntelligenceTransport.Service
      expect(yield* transport.discover({ evaluator: IntelligenceEvaluation.evaluatorPreset("vercel") })).toEqual({
        models: [
          { id: "typesafe-ai/jev", name: "Jev" },
          { id: "typesafe-ai/jev-1.14.0", name: "Jev 1.14.0" },
          { id: "typesafe-ai/jev-1.13.0", name: "Jev 1.13.0" },
        ],
        manual: false,
      })
      expect(yield* transport.discover({ evaluator: IntelligenceEvaluation.evaluatorPreset("openrouter") })).toEqual({
        models: [
          { id: "~typesafe/jev-latest", name: "Jev Latest" },
          { id: "typesafe/jev-1.13", name: "Jev 1.13" },
          { id: "typesafe/jev-1.14", name: "Jev 1.14" },
        ],
        manual: false,
      })
    }),
  )

  it.live("never substitutes the static catalog for an empty Router connection", () =>
    Effect.gen(function* () {
      const requests: string[] = []
      const server = yield* serve((request) => {
        requests.push(new URL(request.url).pathname + new URL(request.url).search)
        return Response.json({ data: [] })
      })
      yield* connect(`${server.url.href}v1`, "Router", "selected")
      const transport = yield* IntelligenceTransport.Service
      expect(yield* transport.discover({ evaluator: (yield* transport.options("red-router"))[0].evaluator })).toEqual({
        models: [],
        manual: false,
      })
      expect(requests).toEqual(["/v1/models?capabilities=decision", "/v1/capabilities"])
    }),
  )

  it.live("recognizes canonical remote aliases without reclassifying chat models", () =>
    Effect.gen(function* () {
      const server = yield* serve(() =>
        Response.json({
          data: [
            { id: "decision-alias", canonical_model_id: "typesafe/jev-latest" },
            { id: "typesafe/jev-1.13", type: "chat", canonical_model_id: "typesafe/jev-latest" },
            { id: "typesafe/jev-router", type: "chat" },
          ],
        }),
      )
      yield* connect(`${server.url.href}v1`, "Router", "selected")
      const transport = yield* IntelligenceTransport.Service
      const catalog = yield* transport.discover({ evaluator: (yield* transport.options("red-router"))[0].evaluator })
      expect(catalog.models.map((model) => model.id)).toEqual(["decision-alias"])
    }),
  )

  it.live("retains a model's advertised decisions endpoint for probe and execution", () =>
    Effect.gen(function* () {
      const calls: string[] = []
      const server = yield* serve((request) => {
        const url = new URL(request.url)
        calls.push(`${request.method} ${url.pathname}${url.search}`)
        if (request.method === "GET")
          return Response.json({
            data: [
              {
                id: "router/relay/typesafe/jev-2.0",
                name: "JEV 2",
                supported_endpoints: ["/v1/decisions"],
              },
            ],
          })
        expect(url.pathname).toBe("/v1/decisions")
        return Response.json({
          model: "jev-2.0",
          answers: { check: { type: "noul", noul: 1 } },
          usage: { input_tokens: 2, output_tokens: 1 },
        })
      })
      yield* connect(`${server.url.href}v1`, "Router", "selected")
      const transport = yield* IntelligenceTransport.Service
      const evaluator = (yield* transport.options("red-router"))[0].evaluator
      const catalog = yield* transport.discover({ evaluator })
      const selected = { ...evaluator, model: catalog.models[0]!.id, endpoint: catalog.models[0]!.endpoint }
      const checked = yield* transport.probe({ evaluator: selected })
      expect(checked).toMatchObject({ ok: true, endpoint: "decisions" })
      yield* transport.request({ ...selected, endpoint: checked.endpoint }, "systemone", {
        model: selected.model,
        state: "fixture",
        questions: {},
      })
      expect(calls).toEqual(["GET /v1/models?capabilities=decision", "POST /v1/decisions", "POST /v1/decisions"])
    }),
  )

  it.live("negotiates a missing legacy route only in setup and retains the successful endpoint", () =>
    Effect.gen(function* () {
      const calls: string[] = []
      const server = yield* serve((request) => {
        const route = new URL(request.url).pathname
        calls.push(route)
        if (route === "/v1/systemone") return new Response(null, { status: 404 })
        return Response.json({
          model: "jev",
          answers: { check: { type: "noul", noul: 1 } },
          usage: { input_tokens: 0, output_tokens: 1 },
        })
      })
      yield* connect(`${server.url.href}v1`, "Router", "selected")
      const transport = yield* IntelligenceTransport.Service
      const evaluator = (yield* transport.options("red-router"))[0].evaluator
      const result = yield* transport.probe({ evaluator })
      expect(result).toMatchObject({ ok: true, endpoint: "decisions" })
      expect(result.requests.map((request) => request.status)).toEqual([404, 200])
      yield* transport.probe({ evaluator: { ...evaluator, endpoint: result.endpoint } })
      expect(calls).toEqual(["/v1/systemone", "/v1/decisions", "/v1/decisions"])
    }),
  )

  for (const status of [401, 403, 400, 502]) {
    it.live(`does not treat HTTP ${status} as a missing decision endpoint`, () =>
      Effect.gen(function* () {
        const calls: string[] = []
        const server = yield* serve((request) => {
          calls.push(new URL(request.url).pathname)
          return new Response("Failed", { status })
        })
        yield* connect(`${server.url.href}v1`, "Router", "selected")
        const transport = yield* IntelligenceTransport.Service
        const result = yield* transport.probe({ evaluator: (yield* transport.options("red-router"))[0].evaluator })
        expect(result.ok).toBe(false)
        expect(result.requests[0]).toMatchObject({ status, bytes: 6 })
        expect(calls).toEqual(["/v1/systemone"])
      }),
    )
  }

  it.live("discovers S1 from capabilities when the filtered catalog is empty", () =>
    Effect.gen(function* () {
      const server = yield* serve((request) =>
        new URL(request.url).pathname === "/v1/capabilities"
          ? Response.json({ systemone: { endpoint: "/v1/decisions", models: ["typesafe/jev-3.0"] } })
          : Response.json({ data: [] }),
      )
      yield* connect(`${server.url.href}v1`, "Router", "selected")
      const transport = yield* IntelligenceTransport.Service
      expect(yield* transport.discover({ evaluator: (yield* transport.options("red-router"))[0].evaluator })).toEqual({
        models: [{ id: "typesafe/jev-3.0", name: "typesafe/jev-3.0", endpoint: "decisions" }],
        manual: false,
      })
    }),
  )
  it.live("a System One probe reports upstream status, response bytes and latency", () =>
    Effect.gen(function* () {
      const body = JSON.stringify({
        model: "native-decision",
        answers: { check: { type: "noul", noul: 1 } },
        usage: { input_tokens: 2, output_tokens: 1 },
      })
      const server = yield* serve((request) => {
        expect(new URL(request.url).pathname).toBe("/v1/systemone")
        return new Response(body)
      })
      yield* connect(`${server.url.href}v1`, "Router", "selected")
      const transport = yield* IntelligenceTransport.Service
      const result = yield* transport.probe({
        evaluator: { ...(yield* transport.options("red-router"))[0].evaluator, model: "native-decision" },
      })
      expect(result.ok).toBe(true)
      expect(result.requests[0]).toMatchObject({
        status: 200,
        method: "POST",
        bytes: new TextEncoder().encode(body).byteLength,
      })
      expect(result.requests[0].durationMs).toBeGreaterThan(0)
    }),
  )

  it.live("a denied System One probe keeps the upstream 401 diagnostics", () =>
    Effect.gen(function* () {
      const server = yield* serve(() => new Response("Unauthorized", { status: 401 }))
      yield* connect(`${server.url.href}v1`, "Router", "selected")
      const transport = yield* IntelligenceTransport.Service
      const result = yield* transport.probe({ evaluator: (yield* transport.options("red-router"))[0].evaluator })
      expect(result.ok).toBe(false)
      expect(result.requests[0]).toMatchObject({ status: 401, bytes: 12 })
    }),
  )
  it.live("lists the selected account's decision models from the OpenAI catalog when the old route is absent", () =>
    Effect.gen(function* () {
      const requests: string[] = []
      const server = yield* serve((request) => {
        requests.push(new URL(request.url).pathname + new URL(request.url).search)
        expect(request.headers.get("authorization")).toBe("Bearer selected")
        if (new URL(request.url).search) return new Response(null, { status: 400 })
        if (new URL(request.url).pathname === "/v1/models/systemone") return new Response(null, { status: 404 })
        return Response.json({
          object: "list",
          data: [
            { id: "chat-model", type: "chat" },
            { id: "typesafe/jev-1.13.0", name: "Jev", type: "systemone", provider: { name: "TypeSafe", via: [] } },
            { id: "other-decision", name: "Decision", supported_endpoints: ["/v1/decisions"] },
            { id: "typesafe/jev-1.13.0", type: "systemone" },
          ],
        })
      })
      const baseURL = `${server.url.href}v1`
      const chosen = yield* connect(baseURL, "Work", "selected")
      yield* connect("http://127.0.0.1:1/v1", "Personal", "other")
      const transport = yield* IntelligenceTransport.Service
      const options = yield* transport.options("red-router")
      expect(options.map((option) => option.name)).toEqual(["Personal", "Work"])
      const evaluator = options.find((option) => option.evaluator.credentialID === chosen.id)!.evaluator
      const catalog = yield* transport.discover({ evaluator })
      expect(catalog.models.map((model) => model.id)).toEqual(["typesafe/jev-1.13.0", "other-decision"])
      expect(catalog.manual).toBe(false)
      expect(requests).toEqual(["/v1/models?capabilities=decision", "/v1/models/systemone", "/v1/models"])
    }),
  )

  it.live("preserves the old dedicated decision catalog", () =>
    Effect.gen(function* () {
      const server = yield* serve((request) => {
        if (new URL(request.url).search) return new Response(null, { status: 400 })
        expect(new URL(request.url).pathname).toBe("/v1/models/systemone")
        return Response.json({ data: [{ id: "native-decision", name: "Native decision" }] })
      })
      yield* connect(`${server.url.href}v1`, "Router", "selected")
      const transport = yield* IntelligenceTransport.Service
      const catalog = yield* transport.discover({ evaluator: (yield* transport.options("red-router"))[0].evaluator })
      expect(catalog.models.map((model) => model.id)).toEqual(["native-decision"])
    }),
  )

  it.live("reports denied discovery without falling back or offering a guessed model", () =>
    Effect.gen(function* () {
      const requests: string[] = []
      const server = yield* serve((request) => {
        requests.push(new URL(request.url).pathname + new URL(request.url).search)
        return new Response(null, { status: 401 })
      })
      yield* connect(`${server.url.href}v1`, "Denied", "selected")
      const transport = yield* IntelligenceTransport.Service
      const result = yield* transport
        .discover({ evaluator: (yield* transport.options("red-router"))[0].evaluator })
        .pipe(Effect.flip)
      expect(result.status).toBe(401)
      expect(requests).toEqual(["/v1/models?capabilities=decision"])
    }),
  )

  it.live("accepts current RedRouter capabilities without claiming the connection was probed", () =>
    Effect.gen(function* () {
      const server = yield* serve(() =>
        Response.json({
          product: "red-router",
          systemone: { endpoint: "/v1/systemone", models: ["typesafe/jev-1.13.0"], availability: "not_probed" },
          catalog: { recommendations: false },
        }),
      )
      const chosen = yield* connect(`${server.url.href}v1`, "Router", "selected")
      const router = yield* IntelligenceRouter.detect(chosen)
      expect(router?.evaluator?.credentialID).toBe(chosen.id)
      expect(router?.evaluator?.model).toBe("typesafe/jev-1.13.0")
      const intelligence = yield* Intelligence.Service
      const status = yield* intelligence.status()
      expect(status.evaluators.filter((option) => option.evaluator.transport === "red-router")).toEqual([
        expect.objectContaining({
          name: "Router",
          configured: false,
          evaluator: expect.objectContaining({ model: "typesafe/jev-1.13.0", credentialID: chosen.id }),
        }),
      ])
    }),
  )
  it.live("does not use another account when the selected credential was removed", () =>
    Effect.gen(function* () {
      const requests: string[] = []
      const server = yield* serve((request) => {
        requests.push(new URL(request.url).pathname + new URL(request.url).search)
        return Response.json({ data: [{ id: "jev" }] })
      })
      const chosen = yield* connect(`${server.url.href}v1`, "Work", "selected")
      const transport = yield* IntelligenceTransport.Service
      const evaluator = (yield* transport.options("red-router"))[0].evaluator
      yield* connect(`${server.url.href}v1`, "Personal", "other")
      const credentials = yield* Credential.Service
      yield* credentials.remove(chosen.id)
      const result = yield* transport.discover({ evaluator }).pipe(Effect.flip)
      expect(result.message).toBe("System One credential was removed; reconnect it")
      expect(requests).toEqual([])
    }),
  )
  it.live("uses connected Zen and Cloudflare accounts through their integration aliases", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const zen = yield* credentials.create({
        integrationID: Integration.ID.make("opencode"),
        label: "Zen account",
        value: Credential.Key.make({ type: "key", key: "zen" }),
      })
      const cloudflare = yield* credentials.create({
        integrationID: Integration.ID.make("cloudflare-workers-ai"),
        label: "Cloudflare account",
        value: Credential.Key.make({ type: "key", key: "cloudflare" }),
      })
      const transport = yield* IntelligenceTransport.Service
      expect((yield* transport.options("opencode-zen"))[0].evaluator.credentialID).toBe(zen.id)
      expect((yield* transport.options("cloudflare-ai-gateway"))[0].evaluator.credentialID).toBe(cloudflare.id)
      expect(yield* transport.options("typesafe")).toEqual([])
    }),
  )
  it.live("prefers the new decision-capability catalog and recognizes its metadata", () =>
    Effect.gen(function* () {
      const requests: string[] = []
      const server = yield* serve((request) => {
        requests.push(new URL(request.url).pathname + new URL(request.url).search)
        return Response.json({
          object: "list",
          data: [
            { id: "choice-model", capabilities: { decision: true } },
            { id: "score-model", supported_endpoints: ["decisions"] },
            { id: "generator", capabilities: { decision: false } },
          ],
        })
      })
      yield* connect(`${server.url.href}v1`, "Router", "selected")
      const transport = yield* IntelligenceTransport.Service
      const catalog = yield* transport.discover({ evaluator: (yield* transport.options("red-router"))[0].evaluator })
      expect(catalog.models.map((model) => model.id)).toEqual(["choice-model", "score-model"])
      expect(requests).toEqual(["/v1/models?capabilities=decision"])
    }),
  )
})

describe("OpenRouter System One transport", () => {
  for (const api of ["v1", "alpha"]) {
    it.live(`uses the selected connection and typed payload at /api/${api}`, () =>
      Effect.gen(function* () {
        const calls: string[] = []
        const server = yield* serve(async (request) => {
          const url = new URL(request.url)
          calls.push(`${request.method} ${url.pathname}`)
          expect(request.headers.get("authorization")).toBe("Bearer chosen-openrouter")
          expect(await request.json()).toEqual({
            model: "typesafe/jev-1.13",
            state: "The sky is blue.",
            questions: { check: { type: "noul", instructions: "Does the text explicitly say the sky is blue?" } },
          })
          return Response.json({
            model: "typesafe/jev-1.13",
            answers: { check: { type: "noul", noul: 1 } },
            usage: { input_tokens: 2, output_tokens: 1 },
          })
        })
        const credentials = yield* Credential.Service
        const chosen = yield* credentials.create({
          integrationID: Integration.ID.make("openrouter"),
          label: "Chosen",
          value: Credential.Key.make({
            type: "key",
            key: "chosen-openrouter",
            configuration: { baseURL: `${server.url.href}api/${api}` },
            metadata: { baseURL: "https://old.example/api/v1" },
          }),
        })
        yield* credentials.create({
          integrationID: Integration.ID.make("openrouter"),
          label: "Other account",
          value: Credential.Key.make({
            type: "key",
            key: "other",
            configuration: { baseURL: "http://127.0.0.1:1/api/v1" },
          }),
        })
        const transport = yield* IntelligenceTransport.Service
        const evaluator = (yield* transport.options("openrouter")).find(
          (item) => item.evaluator.credentialID === chosen.id,
        )!.evaluator
        expect(evaluator.baseURL).toBe(`${server.url.href}api/${api}`)
        expect(yield* transport.probe({ evaluator })).toMatchObject({ ok: true })
        expect(calls).toEqual([`POST /api/${api}/${api === "alpha" ? "decisions" : "systemone"}`])
      }),
    )
  }

  test("keeps saved official alpha evaluators usable without widening credential origins", () => {
    const evaluator = {
      ...IntelligenceEvaluation.evaluatorPreset("openrouter"),
      baseURL: "https://openrouter.ai/api/alpha",
    }
    const credential = (baseURL?: string) =>
      new Credential.Info({
        id: Credential.ID.create(),
        integrationID: Integration.ID.make("openrouter"),
        label: "OpenRouter",
        value: Credential.Key.make({
          type: "key",
          key: "selected",
          ...(baseURL ? { configuration: { baseURL } } : {}),
        }),
      })
    expect(credentialMatches(evaluator, credential())).toBe(true)
    expect(credentialMatches(evaluator, credential("https://openrouter.ai/api/v1"))).toBe(true)
    expect(credentialMatches(evaluator, credential("https://other.example/api/v1"))).toBe(false)
    expect(credentialMatches({ ...evaluator, baseURL: "https://other.example/api/alpha" }, credential())).toBe(false)
    expect(credentialMatches(evaluator, credential("https://openrouter.ai/api/v1?key=bad"))).toBe(false)
  })

  it.live("rejects an invalid configured connection instead of sending its key to metadata fallback", () =>
    Effect.gen(function* () {
      const calls: string[] = []
      const server = yield* serve((request) => {
        calls.push(request.url)
        return new Response(null)
      })
      const credentials = yield* Credential.Service
      const chosen = yield* credentials.create({
        integrationID: Integration.ID.make("openrouter"),
        label: "Invalid",
        value: Credential.Key.make({
          type: "key",
          key: "secret",
          configuration: { baseURL: "https://other@example.com/api/v1" },
          metadata: { baseURL: `${server.url.href}api/v1` },
        }),
      })
      const transport = yield* IntelligenceTransport.Service
      expect(yield* transport.options("openrouter")).toEqual([])
      const checked = yield* transport.probe({
        evaluator: {
          ...IntelligenceEvaluation.evaluatorPreset("openrouter"),
          baseURL: `${server.url.href}api/v1`,
          credentialID: chosen.id,
        },
      })
      expect(checked.ok).toBe(false)
      expect(checked.message).toContain("does not belong")
      expect(calls).toEqual([])
    }),
  )
})

describe("current RedRouter decision contract", () => {
  it.live("converts OpenRouter visual decisions into image content parts without changing the model", () =>
    Effect.gen(function* () {
      const calls: string[] = []
      const server = yield* serve(async (request) => {
        calls.push(new URL(request.url).pathname)
        expect(request.headers.get("TypeSafe-Danger-Zone-Images")).toBe("true")
        const body = Schema.decodeUnknownSync(
          Schema.Struct({ model: Schema.String, state: Schema.Unknown, assets: Schema.optional(Schema.Unknown) }),
        )(await request.json())
        expect(body.model).toBe("typesafe/jev-selected")
        expect(body.assets).toBeUndefined()
        expect(body.state).toEqual([
          { type: "text", text: JSON.stringify({ sources: { image: "capture-id", text: "Recorded brief" } }) },
          { type: "text", text: "Rendered image reference: capture-id" },
          { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } },
        ])
        return Response.json({ model: body.model, answers: {}, usage: { input_tokens: 1, output_tokens: 0 } })
      })
      const transport = yield* IntelligenceTransport.Service
      yield* transport.request(
        { transport: "openrouter", baseURL: server.url.href, endpoint: "decisions", model: "typesafe/jev-selected" },
        "systemone",
        {
          model: "typesafe/jev-selected",
          state: { sources: { image: "capture-id", text: "Recorded brief" } },
          questions: {},
          assets: { "capture-id": { type: "image", format: "png", data_base64: "aW1hZ2U=" } },
        },
        "fixture-key",
      )
      expect(calls).toEqual(["/decisions"])
    }),
  )
  it.live("uses the first advertised alias and preserves full routed IDs on the wire", () =>
    Effect.gen(function* () {
      const id = "red/red/openrouter/typesafe/jev-1.13"
      const calls: string[] = []
      const server = yield* serve(async (request) => {
        const url = new URL(request.url)
        calls.push(`${request.method} ${url.pathname}${url.search}`)
        if (request.method === "GET")
          return Response.json({
            data: [
              { id: "red/openrouter/typesafe/jev-router", type: "chat" },
              {
                id,
                capabilities: { decision: true },
                supported_endpoints: ["chat/completions", "systemone", "decisions"],
              },
            ],
          })
        expect(await request.json()).toMatchObject({ model: id })
        return Response.json({
          model: id,
          answers: { check: { type: "noul", noul: 1 } },
          usage: { input_tokens: 2, output_tokens: 1 },
        })
      })
      yield* connect(`${server.url.href}v1`, "Router", "selected")
      const transport = yield* IntelligenceTransport.Service
      const evaluator = (yield* transport.options("red-router"))[0].evaluator
      const catalog = yield* transport.discover({ evaluator })
      expect(catalog.models).toEqual([
        { id, endpoint: "systemone", name: "RedRouter » RedRouter » RedRouter » openrouter · typesafe/jev-1.13" },
      ])
      expect(
        yield* transport.probe({
          evaluator: { ...evaluator, model: catalog.models[0]!.id, endpoint: catalog.models[0]!.endpoint },
        }),
      ).toMatchObject({ ok: true, endpoint: "systemone" })
      expect(calls).toEqual(["GET /v1/models?capabilities=decision", "POST /v1/systemone"])
    }),
  )

  for (const endpoint of ["systemone", "/v1/systemone", "decisions", "/v1/decisions"]) {
    it.live(`preserves capabilities endpoint ${endpoint} in detection and discovery`, () =>
      Effect.gen(function* () {
        const server = yield* serve((request) =>
          new URL(request.url).pathname === "/v1/capabilities"
            ? Response.json({
                product: "red-router",
                systemone: { endpoint, models: ["openrouter/typesafe/jev-1.13"], availability: "not_probed" },
              })
            : Response.json({ data: [] }),
        )
        const chosen = yield* connect(`${server.url.href}v1`, "Router", "selected")
        const detected = yield* IntelligenceRouter.detect(chosen)
        expect(detected?.evaluator?.endpoint).toBe(endpoint.endsWith("decisions") ? "decisions" : "systemone")
        const transport = yield* IntelligenceTransport.Service
        const evaluator = (yield* transport.options("red-router"))[0].evaluator
        expect((yield* transport.discover({ evaluator })).models[0]?.endpoint).toBe(detected?.evaluator?.endpoint)
      }),
    )
  }

  it.live("refreshes discovery for the same key when models are activated or hidden", () =>
    Effect.gen(function* () {
      const models: string[] = []
      const keys: string[] = []
      const server = yield* serve((request) => {
        keys.push(request.headers.get("authorization") ?? "")
        return Response.json({
          product: "red-router",
          systemone: { endpoint: "systemone", models, available: models.length > 0 },
        })
      })
      const chosen = yield* connect(`${server.url.href}v1`, "Router", "selected")
      expect((yield* IntelligenceRouter.detect(chosen))?.evaluator).toBeUndefined()
      models.push("red/openrouter/typesafe/jev-1.13")
      expect((yield* IntelligenceRouter.detect(chosen))?.evaluator?.model).toBe(models[0])
      models.splice(0)
      expect((yield* IntelligenceRouter.detect(chosen))?.evaluator).toBeUndefined()
      expect(keys).toEqual(["Bearer selected", "Bearer selected", "Bearer selected"])
    }),
  )

  for (const code of [
    "systemone_model_unavailable",
    "systemone_credential_rejected",
    "systemone_endpoint_not_found",
    "systemone_transport_failure",
    "systemone_invalid_response",
    "systemone_connection_unavailable",
    "unknown_upstream_error",
  ]) {
    it.live(`reports ${code} without reflecting upstream error text or switching routes`, () =>
      Effect.gen(function* () {
        const calls: string[] = []
        const server = yield* serve((request) => {
          calls.push(new URL(request.url).pathname)
          return Response.json(
            { error: { code, message: "private upstream credential and stack at /secret/file.ts" } },
            { status: 502 },
          )
        })
        yield* connect(`${server.url.href}v1`, "Router", "selected")
        const transport = yield* IntelligenceTransport.Service
        const checked = yield* transport.probe({ evaluator: (yield* transport.options("red-router"))[0].evaluator })
        expect(checked.ok).toBe(false)
        expect(checked.message).toContain("HTTP 502")
        if (code !== "unknown_upstream_error") expect(checked.message).toContain(`(${code})`)
        expect(checked.message).not.toContain("private")
        expect(checked.message).not.toContain("/secret/")
        expect(calls).toEqual(["/v1/systemone"])
      }),
    )
  }

  it.live("does not expose an invalid typed response as schema diagnostics", () =>
    Effect.gen(function* () {
      const server = yield* serve(() => Response.json({ answers: "private upstream data" }))
      yield* connect(`${server.url.href}v1`, "Router", "selected")
      const transport = yield* IntelligenceTransport.Service
      const checked = yield* transport.probe({ evaluator: (yield* transport.options("red-router"))[0].evaluator })
      expect(checked).toMatchObject({ ok: false, message: "Invalid System One typed response" })
      expect(checked.requests[0].status).toBe(200)
    }),
  )
})
