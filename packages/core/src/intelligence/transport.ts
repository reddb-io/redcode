export * as IntelligenceTransport from "./transport.js"

import { Intelligence } from "@opencode/schema/intelligence"
import { Integration } from "@opencode/schema/integration"
import { Router } from "@opencode/schema/router"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Option, Schedule, Schema } from "effect"
import { Credential } from "../credential.js"
import { IntelligenceEvaluation } from "./evaluation.js"
import { IntelligenceSettings } from "./settings.js"
import { redRouterEndpoint } from "./red-router-endpoint.js"
import { ConnectionCheck } from "@opencode/schema/connection-check"
import { RemoteCheck } from "../remote-check.js"
import { ModelsDev } from "../models-dev.js"

const make = Effect.gen(function* () {
  const credentials = yield* Credential.Service

  const connections = Effect.fn("IntelligenceTransport.connections")(function* (
    transport: Intelligence.Evaluator["transport"],
  ) {
    return (yield* credentials.all())
      .filter((item) => {
        if (credentialValue(item.value) === undefined) return false
        if (item.integrationID === Integration.ID.make(`intelligence:${transport}`))
          return item.value.metadata?.intelligenceTransport === transport
        if (transport === "red-router" && item.value.metadata?.router === "red-router") return true
        return (
          providerIntegrations(transport).some((id) => item.integrationID === Integration.ID.make(id)) &&
          (transport === "red-router" || item.value.metadata?.router !== "red-router")
        )
      })
      .toReversed()
  })

  const connection = Effect.fn("IntelligenceTransport.connection")(function* (
    transport: Intelligence.Evaluator["transport"],
  ) {
    return (yield* connections(transport))[0]
  })

  const options = Effect.fn("IntelligenceTransport.options")(function* (
    transport: Intelligence.Evaluator["transport"],
  ) {
    const saved = yield* connections(transport)
    const connected = saved.flatMap((credential) => {
      const baseURL = evaluatorEndpoint(transport, credential)
      return baseURL && IntelligenceSettings.validURL(baseURL)
        ? [
            {
              name: credential.label,
              configured: false,
              evaluator: { ...IntelligenceEvaluation.evaluatorPreset(transport), baseURL, credentialID: credential.id },
            },
          ]
        : []
    })
    if (saved.length) return connected
    return providerEnvironment(transport)
      .filter((name) => process.env[name])
      .slice(0, 1)
      .map((name) => ({
        name,
        configured: false,
        evaluator: {
          ...IntelligenceEvaluation.evaluatorPreset(transport),
          credentialID: undefined,
          ...(transport === "red-router" ? { baseURL: redRouterEndpoint() ?? "" } : {}),
        },
      }))
  })

  const request = Effect.fn("IntelligenceTransport.request")(function* (
    evaluator: Intelligence.Evaluator,
    suffix: string,
    body?: unknown,
    apiKey?: string,
    requests?: ConnectionCheck.Request[],
  ) {
    if (!IntelligenceSettings.validURL(evaluator.baseURL))
      return yield* new IntelligenceEvaluation.Error({
        message: "Use an HTTP(S) base URL without credentials, query or fragment",
      })
    const url = new URL(evaluator.baseURL)
    const explicit = !apiKey && evaluator.credentialID ? yield* credentials.get(evaluator.credentialID) : undefined
    if (!apiKey && evaluator.credentialID && !explicit)
      return yield* new IntelligenceEvaluation.Error({ message: "System One credential was removed; reconnect it" })
    if (explicit && !credentialMatches(evaluator, explicit))
      return yield* new IntelligenceEvaluation.Error({
        message: "Stored System One credential does not belong to this transport and API origin",
      })
    const current = explicit ?? (yield* connection(evaluator.transport))
    const stored = current && credentialMatches(evaluator, current) ? current : undefined
    if (!apiKey && evaluator.credentialID && !stored)
      return yield* new IntelligenceEvaluation.Error({ message: "System One credential was removed; reconnect it" })
    const officialZen =
      evaluator.transport === "opencode-zen" &&
      url.href.replace(/\/$/, "") === IntelligenceEvaluation.evaluatorPreset().baseURL
    const zen = officialZen
      ? (yield* credentials.list(Integration.ID.make("opencode")))
          .toReversed()
          .find((item) => credentialValue(item.value) !== undefined)?.value
      : undefined
    const key =
      apiKey ??
      credentialValue(stored?.value) ??
      credentialValue(zen) ??
      (officialZen
        ? (process.env.OPENCODE_API_KEY ?? "public")
        : providerEnvironment(evaluator.transport)
            .map((name) => process.env[name])
            .find((item) => item !== undefined))
    const metadata = stored?.value.metadata
    const accountID = stringMetadata(metadata, "accountId") ?? process.env.CLOUDFLARE_ACCOUNT_ID
    const gatewayID = stringMetadata(metadata, "gatewayId") ?? process.env.CLOUDFLARE_GATEWAY_ID
    if (evaluator.transport === "cloudflare-ai-gateway" && body !== undefined && !accountID)
      return yield* new IntelligenceEvaluation.Error({
        message: "Cloudflare Account ID is required; connect Cloudflare AI Gateway first",
      })
    const vercel = evaluator.transport === "vercel" && body !== undefined
    const cloudflare = evaluator.transport === "cloudflare-ai-gateway" && body !== undefined
    const endpoint =
      suffix === "systemone"
        ? (evaluator.endpoint ??
          (evaluator.transport === "openrouter" && url.pathname.replace(/\/$/, "").endsWith("/api/alpha")
            ? "decisions"
            : suffix))
        : suffix
    return yield* Effect.tryPromise({
      try: async (signal) => {
        const response = await RemoteCheck.request(
          cloudflare
            ? `${url.href.replace(/\/$/, "")}/accounts/${accountID}/ai/run`
            : `${url.href.replace(/\/$/, "")}/${vercel ? "evaluation-model" : endpoint}`,
          {
            method: body === undefined ? "GET" : "POST",
            redirect: "error",
            signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
            headers: {
              "Content-Type": "application/json",
              ...(key ? { Authorization: `Bearer ${key}` } : {}),
              ...(gatewayID ? { "cf-aig-gateway-id": gatewayID } : {}),
              ...(vercel ? { "ai-evaluation-model-specification-version": "4", "ai-model-id": evaluator.model } : {}),
            },
            ...(body === undefined
              ? {}
              : { body: JSON.stringify(cloudflare ? cloudflareBody(body) : vercel ? vercelBody(body) : body) }),
          },
          requests,
        )
        if (!response.ok) {
          const diagnostic = Option.getOrUndefined(decodeDiagnostic(await response.text()))
          const code = diagnostic?.error.code
          throw new IntelligenceEvaluation.Error({
            message: `System One HTTP ${response.status}${code ? ` · ${SYSTEM_ONE_ERRORS[code]} (${code})` : ""}`,
            status: response.status,
          })
        }
        const result: unknown = await response.json()
        return vercel ? vercelResponse(evaluator.model, body, result) : result
      },
      catch: (cause) =>
        cause instanceof IntelligenceEvaluation.Error
          ? cause
          : new IntelligenceEvaluation.Error({ message: "System One connection failed" }),
    }).pipe(
      Effect.retry({
        times: 1,
        while: (error) => error.status === 429 || error.status === 529,
        schedule: Schedule.exponential("500 millis"),
      }),
    )
  })

  const discover = Effect.fn("IntelligenceTransport.discover")(function* (
    input: Intelligence.Probe,
    requests?: ConnectionCheck.Request[],
  ) {
    if (["openrouter", "cloudflare-ai-gateway", "vercel"].includes(input.evaluator.transport)) {
      // These transports do not expose a key-scoped decision list. The catalog supplies
      // compatible offerings; the selected connection must still pass its inference check.
      const models = (yield* ModelsDev.bundled).flatMap((provider) =>
        providerIntegrations(input.evaluator.transport).includes(provider.info.id)
          ? provider.models
              .filter(
                (model) =>
                  model.type === "decision" &&
                  model.status !== "deprecated" &&
                  IntelligenceEvaluation.isJev(model.canonicalModelID ?? model.id),
              )
              .map((model) => ({ id: model.id, name: model.name }))
          : [],
      )
      return {
        models: models.length ? models : [{ id: input.evaluator.model, name: input.evaluator.model }],
        manual: false,
      }
    }
    const router = input.evaluator.transport === "red-router"
    // Prefer the capability-filtered OpenAI catalog; older routers still expose a dedicated list.
    const dedicated = router
      ? yield* request(input.evaluator, "models?capabilities=decision", undefined, input.apiKey, requests).pipe(
          Effect.map((response) => ({ response, dedicated: false })),
          Effect.catch((error) =>
            [400, 404, 405].includes(error.status ?? 0)
              ? request(input.evaluator, "models/systemone", undefined, input.apiKey, requests).pipe(
                  Effect.map((response) => ({ response, dedicated: true })),
                  Effect.catch((error) =>
                    error.status === 404 || error.status === 405
                      ? request(input.evaluator, "models", undefined, input.apiKey, requests).pipe(
                          Effect.map((response) => ({ response, dedicated: false })),
                        )
                      : Effect.fail(error),
                  ),
                )
              : Effect.fail(error),
          ),
        )
      : { response: yield* request(input.evaluator, "models", undefined, input.apiKey, requests), dedicated: false }
    const catalog = yield* Schema.decodeUnknownEffect(
      Schema.Struct({
        data: Schema.optional(
          Schema.Array(
            Schema.Struct({
              id: Schema.String,
              name: Schema.optional(Schema.String),
              type: Schema.optional(Schema.String),
              canonical_model_id: Schema.optional(Schema.String),
              capabilities: Schema.optional(Schema.Struct({ decision: Schema.optional(Schema.Boolean) })),
              supported_endpoints: Schema.optional(Schema.Array(Schema.String)),
              provider: Schema.optional(
                Schema.Union([
                  Schema.String,
                  Schema.Null,
                  Schema.Struct({
                    id: Schema.optional(Schema.String),
                    name: Schema.optional(Schema.String),
                  }),
                ]),
              ),
            }),
          ),
        ),
        models: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String }))),
      }),
    )(dedicated.response).pipe(
      Effect.mapError(() => new IntelligenceEvaluation.Error({ message: "Invalid System One model catalog" })),
    )
    if (router) {
      const models = (catalog.data ?? [])
        .filter(
          (model) =>
            dedicated.dedicated ||
            model.capabilities?.decision === true ||
            model.type === "systemone" ||
            model.type === "decision" ||
            model.supported_endpoints?.some((endpoint) => /(^|\/)(systemone|decisions)$/.test(endpoint)) ||
            (model.type === undefined && IntelligenceEvaluation.isJev(model.canonical_model_id ?? model.id)),
        )
        .filter((model, index, models) => models.findIndex((item) => item.id === model.id) === index)
        .map((model) => {
          const route = Router.route(model.id)
          const endpoint =
            model.supported_endpoints?.map(Router.systemOneEndpoint).find((endpoint) => endpoint !== undefined) ??
            input.evaluator.endpoint
          return {
            id: model.id,
            ...(endpoint ? { endpoint } : {}),
            name: Router.routeName({
              routers: ["RedRouter", ...route.hops.map(Router.hopName)],
              upstream: (typeof model.provider === "string" ? model.provider : model.provider?.name) ?? route.provider,
              model: model.name ?? route.model,
            }),
          }
        })
      if (models.length) return { models, manual: false }
      // A router may advertise decision models through capabilities while its filtered catalog is empty.
      const capabilities = yield* request(input.evaluator, "capabilities", undefined, input.apiKey, requests).pipe(
        Effect.catch((error) =>
          [404, 405].includes(error.status ?? 0) ? Effect.succeed(undefined) : Effect.fail(error),
        ),
      )
      const advertised = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          systemone: Schema.optional(
            Schema.Struct({
              models: Schema.Array(Schema.String),
              endpoint: Schema.optional(Schema.String),
            }),
          ),
        }),
      )(capabilities ?? {}).pipe(
        Effect.mapError(() => new IntelligenceEvaluation.Error({ message: "Invalid System One capabilities" })),
      )
      const endpoint = Router.systemOneEndpoint(advertised.systemone?.endpoint)
      return {
        models: (advertised.systemone?.models ?? []).map((id) => ({
          id,
          name: id,
          ...(endpoint ? { endpoint } : {}),
        })),
        manual: false,
      }
    }
    return {
      models: [
        ...(catalog.data ?? [])
          .filter((model) => IntelligenceEvaluation.isJev(model.canonical_model_id ?? model.id))
          .map((model) => ({
            id: model.id,
            name:
              [typeof model.provider === "string" ? model.provider : model.provider?.name, model.name]
                .filter(Boolean)
                .join(" · ") || model.id,
          })),
        ...(catalog.models ?? [])
          .filter((model) => IntelligenceEvaluation.isJev(model.name))
          .map((model) => ({ id: model.name, name: model.name })),
      ],
      manual: false,
    }
  })

  const probe = Effect.fn("IntelligenceTransport.probe")(function* (input: Intelligence.Probe) {
    const requests: ConnectionCheck.Request[] = []
    if (input.evaluator.transport === "opencode-zen") {
      const catalog = yield* discover(input, requests).pipe(
        Effect.match({
          onFailure: (left) => ({ _tag: "Left" as const, left }),
          onSuccess: (right) => ({ _tag: "Right" as const, right }),
        }),
      )
      if (catalog._tag === "Left" || !catalog.right.models.some((model) => model.id === input.evaluator.model))
        return {
          ok: false,
          message: "Selected Zen evaluator is unavailable. Connect Zen or choose another evaluator explicitly.",
          requests,
        }
    }
    const body = {
      model: input.evaluator.model,
      state: "The sky is blue.",
      questions: { check: { type: "noul", instructions: "Does the text explicitly say the sky is blue?" } },
    }
    const result = yield* request(input.evaluator, "systemone", body, input.apiKey, requests).pipe(
      Effect.map((response) => ({ response, endpoint: input.evaluator.endpoint ?? ("systemone" as const) })),
      Effect.catch((error) =>
        input.evaluator.transport === "red-router" &&
        !input.evaluator.endpoint &&
        [404, 405].includes(error.status ?? 0)
          ? request({ ...input.evaluator, endpoint: "decisions" }, "systemone", body, input.apiKey, requests).pipe(
              Effect.map((response) => ({ response, endpoint: "decisions" as const })),
            )
          : Effect.fail(error),
      ),
      Effect.flatMap((value) =>
        Schema.decodeUnknownEffect(Intelligence.Response)(value.response).pipe(
          Effect.map((response) => ({ response, endpoint: value.endpoint })),
          Effect.mapError(() => new IntelligenceEvaluation.Error({ message: "Invalid System One typed response" })),
        ),
      ),
      Effect.match({
        onFailure: (left) => ({ _tag: "Left" as const, left }),
        onSuccess: (right) => ({ _tag: "Right" as const, right }),
      }),
    )
    if (result._tag === "Left")
      return {
        ok: false,
        message: result.left instanceof Error ? result.left.message : "Invalid System One response",
        ...(input.evaluator.transport === "red-router" &&
        requests.at(-1)?.status &&
        ![404, 405].includes(requests.at(-1)!.status!)
          ? { endpoint: requests.at(-1)!.url.endsWith("/decisions") ? ("decisions" as const) : ("systemone" as const) }
          : {}),
        requests,
      }
    return {
      ok: result.right.response.answers.check?.type === "noul",
      message:
        result.right.response.answers.check?.type === "noul" ? "Connection checked" : "Invalid System One response",
      ...(input.evaluator.transport === "red-router" ? { endpoint: result.right.endpoint } : {}),
      requests,
    }
  })

  return {
    request,
    discover: (input: Intelligence.Probe, requests?: ConnectionCheck.Request[]) =>
      discover(input, requests).pipe(Effect.map((catalog): Intelligence.Models => catalog)),
    probe: (input: Intelligence.Probe) =>
      probe(input).pipe(Effect.map((check): Intelligence.Check & { requests: ConnectionCheck.Request[] } => check)),
    connection,
    options,
  }
})

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()(
  "@redcode/IntelligenceTransport",
) {}
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [Credential.node],
})

function credentialValue(value: Credential.Value | undefined) {
  if (value?.type === "key") return value.key
  if (value?.type === "oauth" && value.expires > Date.now()) return value.access
}

export function credentialMatches(evaluator: Intelligence.Evaluator, credential: Credential.Info) {
  const metadata = credential.value.metadata
  if (credential.integrationID === Integration.ID.make(`intelligence:${evaluator.transport}`))
    return (
      metadata?.intelligenceTransport === evaluator.transport &&
      metadata.intelligenceBaseURL === new URL(evaluator.baseURL).href.replace(/\/$/, "")
    )
  const baseURL = evaluatorEndpoint(evaluator.transport, credential)
  return (
    (providerIntegrations(evaluator.transport).some((id) => credential.integrationID === Integration.ID.make(id)) ||
      (evaluator.transport === "red-router" && metadata?.router === "red-router")) &&
    baseURL !== undefined &&
    IntelligenceSettings.validURL(baseURL) &&
    (sameEndpoint(baseURL, evaluator.baseURL) ||
      // Older setup stored the official alpha API even for a normal OpenRouter connection.
      (evaluator.transport === "openrouter" &&
        [baseURL, evaluator.baseURL].every((value) =>
          ["https://openrouter.ai/api/alpha", "https://openrouter.ai/api/v1"].includes(value.replace(/\/$/, "")),
        )))
  )
}

function evaluatorEndpoint(transport: Intelligence.Evaluator["transport"], credential: Credential.Info) {
  if (credential.integrationID === Integration.ID.make(`intelligence:${transport}`))
    return stringMetadata(credential.value.metadata, "intelligenceBaseURL")
  if (transport === "red-router") return redRouterEndpoint(credential)
  return (
    (credential.value.type === "key" && typeof credential.value.configuration?.baseURL === "string"
      ? credential.value.configuration.baseURL
      : stringMetadata(credential.value.metadata, "baseURL")) ??
    IntelligenceEvaluation.evaluatorPreset(transport).baseURL
  )
}

function sameEndpoint(left: string, right: string) {
  if (!URL.canParse(left) || !URL.canParse(right)) return false
  const first = new URL(left)
  const second = new URL(right)
  const host = (value: string) =>
    ["localhost", "127.0.0.1", "[::1]"].includes(value) ? "loopback" : value.toLowerCase()
  return (
    first.protocol === second.protocol &&
    host(first.hostname) === host(second.hostname) &&
    first.port === second.port &&
    first.pathname.replace(/\/$/, "") === second.pathname.replace(/\/$/, "")
  )
}

function providerIntegrations(transport: Intelligence.Evaluator["transport"]) {
  if (transport === "opencode-zen") return ["opencode"]
  if (transport === "cloudflare-ai-gateway") return ["cloudflare-ai-gateway", "cloudflare-workers-ai"]
  return [transport]
}

function providerEnvironment(transport: Intelligence.Evaluator["transport"]) {
  if (transport === "opencode-zen") return ["OPENCODE_API_KEY"]
  if (transport === "openrouter") return ["OPENROUTER_API_KEY"]
  if (transport === "typesafe") return ["TYPESAFE_API_KEY"]
  if (transport === "red-router") return ["RED_ROUTER_API_KEY"]
  if (transport === "cloudflare-ai-gateway") return ["CLOUDFLARE_API_TOKEN", "CF_AIG_TOKEN"]
  if (transport === "vercel") return ["AI_GATEWAY_API_KEY"]
  if (transport === "vivgrid") return ["VIVGRID_API_KEY"]
  return ["NANO_GPT_API_KEY"]
}

function stringMetadata(metadata: Record<string, unknown> | undefined, key: string) {
  return typeof metadata?.[key] === "string" ? metadata[key] : undefined
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function cloudflareBody(body: unknown) {
  if (!record(body)) return body
  return { model: body.model, input: { state: body.state, questions: body.questions } }
}

function vercelBody(body: unknown) {
  if (!record(body) || !record(body.questions)) return body
  return {
    state: body.state,
    questions: Object.fromEntries(
      Object.entries(body.questions).map(([id, question]) => [
        id,
        record(question) && question.type === "noul" ? { ...question, type: "boolean" } : question,
      ]),
    ),
  }
}

function vercelResponse(model: string, request: unknown, response: unknown) {
  if (!record(request) || !record(request.questions) || !record(response) || !record(response.answers)) return response
  const questions = request.questions
  const answers = Object.fromEntries(
    Object.entries(response.answers).map(([id, answer]) => {
      const question = questions[id]
      if (!record(question) || !record(answer)) return [id, answer]
      if (question.type === "noul" && answer.type === "boolean") return [id, { type: "noul", noul: answer.probability }]
      if (question.type === "choice" && answer.type === "choice") {
        const probabilities = record(answer.probabilities) ? answer.probabilities : { [String(answer.choice)]: 1 }
        return [id, { ...answer, probabilities, confidence: distributionConfidence(probabilities) }]
      }
      if (question.type === "score" && answer.type === "score") {
        const probabilities = record(answer.probabilities)
          ? answer.probabilities
          : { [String(Math.round(Number(answer.score)))]: 1 }
        const criteria = Array.isArray(question.criteria) ? question.criteria : []
        return [
          id,
          {
            ...answer,
            probabilities,
            confidence: distributionConfidence(probabilities),
            legend: Object.fromEntries(criteria.map((level, index) => [String(index), level])),
          },
        ]
      }
      return [id, answer]
    }),
  )
  const usage = record(response.usage) ? response.usage : {}
  return {
    model,
    answers,
    usage: {
      input_tokens: typeof usage.inputTokens === "number" ? usage.inputTokens : 0,
      output_tokens: typeof usage.outputTokens === "number" ? usage.outputTokens : 0,
    },
  }
}

function distributionConfidence(probabilities: Record<string, unknown>) {
  const values = Object.values(probabilities).filter((value): value is number => typeof value === "number" && value > 0)
  if (values.length <= 1) return 1
  const entropy = -values.reduce((total, value) => total + value * Math.log(value), 0)
  return Math.max(0, Math.min(1, 1 - entropy / Math.log(values.length)))
}

const SYSTEM_ONE_ERRORS = {
  systemone_credential_required: "Upstream credential required",
  systemone_credential_rejected: "Upstream credential or permission rejected",
  systemone_endpoint_not_found: "Upstream decision endpoint is missing",
  systemone_resource_not_found: "Upstream resource is missing; endpoint or model is unspecified",
  systemone_model_unavailable: "Upstream decision model is unavailable",
  systemone_transport_failure: "Router could not reach the upstream",
  systemone_invalid_response: "Upstream returned invalid typed answers",
  systemone_upstream_http_error: "Upstream returned an HTTP error",
  systemone_connection_unavailable: "Router has no eligible S1 connection",
} as const

const decodeDiagnostic = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      error: Schema.Struct({
        code: Schema.Literals(Object.keys(SYSTEM_ONE_ERRORS) as Array<keyof typeof SYSTEM_ONE_ERRORS>),
      }),
    }),
  ),
)
