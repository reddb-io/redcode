import { make as makeClient } from "./generated/client"
import type { Intelligence } from "@reddb-io/redcode-schema/intelligence"
import type { Model } from "@reddb-io/redcode-schema/model"

/** Defaults are offered by onboarding only; existing settings are never migrated implicitly. */
export function evaluatorPreset(
  transport: Intelligence.Evaluator["transport"] = "opencode-zen",
): Intelligence.Evaluator {
  if (transport === "opencode-zen") return { transport, baseURL: "https://opencode.ai/zen/v1", model: "jev-1.13-free" }
  if (transport === "typesafe") return { transport, baseURL: "https://api.typesafe.ai/v1", model: "jev-1.13.0" }
  if (transport === "red-router") return { transport, baseURL: "http://localhost:25050/v1", model: "jev-1.13.0" }
  if (transport === "cloudflare-ai-gateway")
    return { transport, baseURL: "https://api.cloudflare.com/client/v4", model: "typesafe/jev" }
  if (transport === "vercel")
    return { transport, baseURL: "https://ai-gateway.vercel.sh/v4/ai", model: "typesafe-ai/jev" }
  if (transport === "vivgrid") return { transport, baseURL: "https://api.vivgrid.com/v1", model: "jev" }
  return { transport, baseURL: "https://nano-gpt.com/api/v1", model: "typesafe/jev-latest" }
}

/** Shared global setup transport; deliberately independent of location and legacy SDKs. */
export function make(options: Parameters<typeof makeClient>[0]) {
  const client = makeClient(options)
  return {
    probeModel: (model: Model.Ref) => client.intelligenceModels.test(model),
    get: () => client.intelligence.get() as Promise<Intelligence.Status>,
    save: (input: Intelligence.Save) => client.intelligence.save(input) as Promise<Intelligence.Settings>,
    discover: (input: Intelligence.Probe) => client.intelligence.discover(input) as Promise<Intelligence.Models>,
    probe: (input: Intelligence.Probe) => client.intelligence.probe(input) as Promise<Intelligence.Check>,
    history: (sessionID: string) =>
      client.intelligence.history({ sessionID }) as Promise<ReadonlyArray<Intelligence.Evaluation>>,
  }
}
export * as IntelligenceClient from "./intelligence"
