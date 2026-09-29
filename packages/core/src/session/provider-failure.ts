/**
 * The diagnostic context of a failed provider request: which provider and model it went to and
 * which URL it hit, so an opaque "404 page not found" can be told apart from a wrong key, a wrong
 * model id and a wrong host. The URL is stripped of everything that can carry a credential before
 * it is recorded, and every surface renders the context through `describe`.
 */

const REDACTED = "__REDACTED__"

/**
 * Keeps scheme, host, port and path, which are the diagnosis, and drops userinfo, the query string
 * and the fragment, which is where keys and signatures travel.
 */
export function redactURL(input: string) {
  const parsed = URL.parse(input)
  if (!parsed) {
    // Unparseable input keeps the same guarantee: nothing after the first `?` or `#` survives.
    const head = input.split(/[?#]/)[0]
    if (!head) return REDACTED
    return head.replace(/\/\/[^/@\s]*@/, "//")
  }
  parsed.username = ""
  parsed.password = ""
  parsed.search = ""
  parsed.hash = ""
  return parsed.toString()
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
