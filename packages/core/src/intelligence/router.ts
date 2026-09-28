export * as IntelligenceRouter from "./router.js"

import { createHash } from "node:crypto"
import { Effect, Option, Schema } from "effect"
import { Intelligence } from "@opencode/schema/intelligence"
import { Router } from "@opencode/schema/router"
import { Credential } from "../credential.js"
import { redRouterEndpoint } from "./red-router-endpoint.js"

const decodeRecommendation = Schema.decodeUnknownOption(Router.Recommendation)
const cache = new Map<string, { expires: number; value: Intelligence.DetectedRouter | undefined }>()

export function clearCache() {
  cache.clear()
}

export const detect = Effect.fn("IntelligenceRouter.detect")(function* (connection: Credential.Info | undefined) {
  const key =
    connection?.value.type === "key"
      ? connection.value.key
      : connection?.value.type === "oauth" && connection.value.expires > Date.now()
        ? connection.value.access
        : process.env.RED_ROUTER_API_KEY
  if (!key) return
  const base = redRouterEndpoint(connection)
  if (!base) return
  const cacheKey = `${base}\n${createHash("sha256").update(key).digest("hex")}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expires > Date.now()) return cached.value
  const signal = AbortSignal.timeout(3_000)
  const get = (route: string) =>
    fetch(`${base}/${route}`, {
      redirect: "error",
      signal,
      headers: { accept: "application/json", authorization: `Bearer ${key}` },
    })
      .then((response) => (response.ok ? (response.json() as Promise<unknown>) : undefined))
      .catch(() => undefined)
  const capabilities = yield* Effect.promise(() => get("capabilities"))
  const document = record(capabilities)
  const detection: Router.Detection | undefined =
    document.product === "red-router"
      ? fromCapabilities(document)
      : yield* Effect.promise(() => get("models/systemone")).pipe(
          Effect.map((result) => {
            const data = record(result).data
            const models = Array.isArray(data)
              ? data.flatMap((item) => {
                  const id = record(item).id
                  return typeof id === "string" ? [id] : []
                })
              : []
            return models.length && models.every((id) => /\bjev\b/i.test(id))
              ? {
                  kind: "red-router" as const,
                  features: ["systemone" as const],
                  systemOne: { available: true, models },
                  checkedAt: Date.now(),
                }
              : undefined
          }),
        )
  if (!detection) {
    cache.set(cacheKey, { expires: Date.now() + 5 * 60_000, value: undefined })
    return
  }
  const catalog: Record<string, unknown> = detection.features.includes("recommendations")
    ? record(yield* Effect.promise(() => get("catalog")))
    : {}
  const recommendations = record(catalog.recommended)
  const recommended = {
    default: Option.getOrUndefined(decodeRecommendation(recommendations.default)),
    review: Option.getOrUndefined(decodeRecommendation(recommendations.review)),
    systemone: Option.getOrUndefined(decodeRecommendation(recommendations.systemone)),
    vision: Option.getOrUndefined(decodeRecommendation(recommendations.vision)),
  }
  const model = detection.systemOne?.available
    ? detection.systemOne.models.find((id) => id === recommended.systemone?.id) ?? detection.systemOne.models[0]
    : undefined
  const result = {
    providerID: connection?.integrationID ?? "red-router",
    baseURL: base,
    detection,
    ...(Object.values(recommended).some((item) => item !== undefined) ? { recommended } : {}),
    ...(model
      ? {
          evaluator: {
            transport: "red-router" as const,
            baseURL: base,
            model,
            ...(connection ? { credentialID: connection.id } : {}),
          },
        }
      : {}),
  } satisfies Intelligence.DetectedRouter
  cache.set(cacheKey, { expires: Date.now() + 5 * 60_000, value: result })
  return result
})

function fromCapabilities(document: Record<string, unknown>): Router.Detection {
  const systemOne = record(document.systemone)
  const decision = record(document.decision)
  const session = record(document.session)
  const catalog = record(document.catalog)
  const reasoning = record(document.reasoning)
  const accepts = Array.isArray(reasoning.accepts) ? reasoning.accepts : []
  const hintKeys = Array.isArray(decision.hint_keys) ? decision.hint_keys : []
  const models = Array.isArray(systemOne.models)
    ? systemOne.models.filter((item): item is string => typeof item === "string" && item.length > 0)
    : []
  const available = systemOne.available === true && models.length > 0
  const flags: Array<[Router.Feature, boolean]> = [
    ["capabilities", true],
    ["systemone", available],
    ["combos", Array.isArray(record(document.combos).strategies)],
    ["decision", typeof decision.header === "string"],
    ["hint", decision.accepts_hint === true],
    ["token-saver", typeof document.token_saver_header === "string"],
    ["session-affinity", session.per_session_stickiness === true || Array.isArray(session.affinity_headers)],
    ["served-model", typeof document.served_model_header === "string"],
    ["cost", typeof document.cost_header === "string"],
    ["stream-usage-cost", document.stream_usage_cost === true],
    ["catalog", catalog.model_parameters === true],
    ["reasoning", typeof reasoning.header === "string"],
    ["reasoning-auto", typeof reasoning.header === "string" && accepts.includes("auto")],
    ["reasoning-applies", typeof reasoning.header === "string" && reasoning.applies === true],
    ["hint-signals", ["stall", "feedback", "frustration"].every((key) => hintKeys.includes(key))],
    ["recommendations", catalog.recommendations === true && typeof catalog.catalog_endpoint === "string"],
  ]
  return {
    kind: "red-router",
    ...(typeof document.version === "string" ? { version: document.version } : {}),
    ...(typeof document.instance_id === "string" ? { instanceID: document.instance_id } : {}),
    ...(typeof catalog.version === "string" && catalog.version ? { catalogVersion: catalog.version } : {}),
    features: flags.filter(([, enabled]) => enabled).map(([feature]) => feature),
    systemOne: { available, models },
    checkedAt: Date.now(),
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
