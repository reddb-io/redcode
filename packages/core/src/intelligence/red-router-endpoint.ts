import type { Credential } from "../credential.js"
import { IntelligenceEvaluation } from "./evaluation.js"

export function redRouterEndpoint(credential?: Credential.Info) {
  const value = credential?.value
  const configured =
    value?.type === "key" && typeof value.configuration?.baseURL === "string"
      ? value.configuration.baseURL
      : typeof value?.metadata?.baseURL === "string"
        ? value.metadata.baseURL
        : (process.env.RED_ROUTER_BASE_URL ?? IntelligenceEvaluation.evaluatorPreset("red-router").baseURL)
  return normalizeRouterEndpoint(configured)
}

export function normalizeRouterEndpoint(configured: string) {
  if (!URL.canParse(configured)) return
  const url = new URL(configured)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/models$/, "") || "/v1"
  return url.href.replace(/\/+$/, "")
}
