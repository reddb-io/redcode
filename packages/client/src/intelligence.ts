import { Model } from "@reddb-io/redcode-schema/model"
import { Schema } from "effect"
import { Intelligence } from "@reddb-io/redcode-schema/intelligence"

/** Defaults are offered by onboarding only; existing settings are never migrated implicitly. */
export function evaluatorPreset(transport: Intelligence.Evaluator["transport"] = "opencode-zen"): Intelligence.Evaluator {
  if (transport === "opencode-zen") return { transport, baseURL: "https://opencode.ai/zen/v1", model: "jev-1.13-free" }
  if (transport === "typesafe") return { transport, baseURL: "https://api.typesafe.ai/v1", model: "jev-1.13.0" }
  return { transport, baseURL: "http://localhost:25050/v1", model: "jev-1.13.0" }
}

/** Shared global setup transport; deliberately independent of location and legacy SDKs. */
export function make(options: { baseUrl: string; fetch?: typeof fetch; headers?: HeadersInit }) {
  const request = async <A>(
    method: string,
    route: string,
    schema: Schema.Codec<A, unknown, never, never>,
    body?: unknown,
  ) => {
    const headers = new Headers(options.headers)
    headers.set("Content-Type", "application/json")
    const response = await (options.fetch ?? fetch)(new URL(`/api/intelligence${route}`, options.baseUrl), {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) throw new Error(`Intelligence request failed (${response.status})`)
    return Schema.decodeUnknownSync(schema)(await response.json())
  }
  return {
    probeModel: (model: Model.Ref) => request("POST", "/test-model", Intelligence.Check, model),
    get: () => request("GET", "", Intelligence.Status),
    save: (input: typeof Intelligence.Save.Type) => request("PUT", "", Intelligence.Settings, input),
    discover: (input: typeof Intelligence.Probe.Type) => request("POST", "/models", Intelligence.Models, input),
    probe: (input: typeof Intelligence.Probe.Type) => request("POST", "/test", Intelligence.Check, input),
    history: (sessionID: string) =>
      request("GET", `/evaluations?sessionID=${encodeURIComponent(sessionID)}`, Schema.Array(Intelligence.Evaluation)),
  }
}
export * as IntelligenceClient from "./intelligence"
