import { AIError, ToolFailure } from "@opencode/ai"
import { Tool } from "@opencode/schema/tool"
import { SessionError } from "@opencode/schema/session-error"
import { Permission } from "../permission.js"
import { Integration } from "../integration.js"
import { AgentNotFoundError, StepFailedError } from "./error.js"
import { ProviderFailure } from "./provider-failure.js"
import { SessionRunnerModel } from "./runner/model.js"

/** The provider and model a request went to, known where the runner resolved them. */
export interface Route {
  readonly provider: string
  readonly model: string
}

export function toSessionError(cause: unknown, route?: Route): SessionError.Error {
  if (cause instanceof AIError) {
    switch (cause.reason._tag) {
      case "RateLimit":
        return providerError("provider.rate-limit", cause.reason, route)
      case "Authentication":
        return providerError("provider.auth", cause.reason, route)
      case "QuotaExceeded":
        return providerError("provider.quota", cause.reason, route)
      case "ContentPolicy":
        return providerError("provider.content-filter", cause.reason, route)
      case "Transport":
        return providerError("provider.transport", cause.reason, route)
      case "ProviderInternal":
        return providerError("provider.internal", cause.reason, route)
      case "InvalidProviderOutput":
        return providerError("provider.invalid-output", cause.reason, route)
      case "InvalidRequest":
        return providerError("provider.invalid-request", cause.reason, route)
      case "UnsupportedOperation":
        return providerError("provider.unsupported-operation", cause.reason, route)
      case "NoRoute":
        return providerError("provider.no-route", cause.reason, route)
      case "UnknownProvider":
        return providerError("provider.unknown", cause.reason, route)
      case "Timeout":
        return providerError("provider.timeout", cause.reason, route)
      default: {
        const exhaustive: never = cause.reason
        return exhaustive
      }
    }
  }
  if (cause instanceof Permission.BlockedError) return { type: "permission.rejected", message: cause.message }
  if (cause instanceof ToolFailure || cause instanceof Tool.Error) {
    if (cause.error === undefined) return { type: "tool.execution", message: cause.message }
    // The canonical error is the sole model-visible representation, so a cause
    // with no message must not erase the tool's curated failure message.
    const unwrapped = toSessionError(cause.error)
    return unwrapped.message === "" ? { ...unwrapped, type: "tool.execution", message: cause.message } : unwrapped
  }
  if (cause instanceof StepFailedError) return cause.error
  if (cause instanceof SessionRunnerModel.UnsupportedCompactionError)
    return { type: "provider.unsupported-operation", message: cause.message }
  if (cause instanceof AgentNotFoundError) return { type: "unknown", message: cause.message }
  if (
    cause instanceof SessionRunnerModel.ModelNotSelectedError ||
    cause instanceof SessionRunnerModel.ModelUnavailableError ||
    cause instanceof SessionRunnerModel.VariantUnavailableError ||
    cause instanceof SessionRunnerModel.UnsupportedPackageError ||
    cause instanceof SessionRunnerModel.ModelConfigurationError ||
    cause instanceof SessionRunnerModel.ModelInitializationError ||
    cause instanceof SessionRunnerModel.UnresolvedProviderVariablesError
  )
    return { type: "provider.no-route", message: cause.message }
  if (cause instanceof Integration.AuthorizationError) return { type: "provider.auth", message: cause.message }
  return { type: "unknown", message: cause instanceof Error ? cause.message : String(cause) }
}

function providerError(type: string, reason: AIError["reason"], route: Route | undefined): SessionError.Error {
  const status = reason.http?.status
  // Only a transport failure names its URL: elsewhere the host answered, so the URL is not the diagnosis.
  const url = reason._tag === "Transport" ? (reason.url ?? reason.http?.url) : undefined
  return {
    type,
    message: reason.message,
    ...(status === undefined ? {} : { status }),
    ...(route === undefined ? {} : { provider: route.provider, model: route.model }),
    ...(url === undefined ? {} : { url: ProviderFailure.redactURL(url) }),
  }
}
