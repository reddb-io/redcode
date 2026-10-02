import { describe, expect } from "bun:test"
import { Credential } from "@opencode/core/credential"
import { Intelligence } from "@opencode/core/intelligence"
import { IntelligenceTransport } from "@opencode/core/intelligence/transport"
import { IntelligenceRouter } from "@opencode/core/intelligence/router"
import { Integration } from "@opencode/schema/integration"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect } from "effect"
import { tempGlobalLayer } from "../fixture/global"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([Intelligence.node, IntelligenceTransport.node, Credential.node]), {
    replacements: [Global.node.replace(tempGlobalLayer)],
  }),
)

const serve = (fetch: (request: Request) => Response) =>
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

describe("connection-scoped System One discovery", () => {
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
