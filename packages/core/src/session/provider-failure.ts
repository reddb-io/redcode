/**
 * The diagnostic context of a failed provider request: which provider and model it went to and
 * which URL it hit, so an opaque "404 page not found" can be told apart from a wrong key, a wrong
 * model id and a wrong host. The URL is stripped of everything that can carry a credential before
 * it is recorded, and every surface renders the context through `describe`.
 */

import { Redact } from "@opencode/util/redact"

/** Keeps scheme, host, port and path, and drops userinfo, the query string and the fragment. */
export function redactURL(input: string) {
  return Redact.redactURL(input)
}

/** The fields of a structured session error that carry request context. */
export interface Described {
  readonly message: string
  readonly status?: number
  readonly provider?: string
  readonly model?: string
  readonly url?: string
}

/** One line for people and logs: the message, then the provider, model, request URL and HTTP status. */
export function describe(error: Described) {
  const details = [
    error.provider && error.model ? `${error.provider}/${error.model}` : (error.provider ?? error.model),
    error.url,
    error.status === undefined ? undefined : `HTTP ${error.status}`,
  ].filter((detail): detail is string => Boolean(detail))
  if (details.length === 0) return error.message
  return `${error.message} (${details.join(", ")})`
}

export * as ProviderFailure from "./provider-failure.js"
