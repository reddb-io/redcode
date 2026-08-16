/**
 * Renders the diagnostic context Redcode already records for a failed provider
 * request — resolved provider, model, request URL and HTTP status — so an opaque
 * response body such as "404 Page not found" can be told apart from a wrong API
 * key, a wrong model id, and a wrong host.
 *
 * Every consumer (CLI run loop, CLI scrollback, TUI message panel) goes through
 * here so the credential redaction below cannot drift between surfaces.
 */
export namespace ProviderFailure {
  /**
   * Marker for a value that was withheld. Deliberately free of characters that
   * `URL.toString()` would percent-encode, so a redacted URL stays readable.
   */
  export const REDACTED = "__REDACTED__"

  /**
   * Query parameters whose value may be shown. This is an allowlist rather than
   * a denylist of key-ish names on purpose: it fails safe when a provider names
   * its credential parameter something we have never seen. Only parameters that
   * are themselves a diagnosis (Azure's deployment api-version) belong here.
   */
  const VISIBLE_QUERY_PARAMS = new Set(["api-version", "api_version", "version"])

  /**
   * Strips every credential-bearing part of a request URL: userinfo, fragment,
   * and any query value not on the allowlist. Scheme, host, port and path
   * survive because they are the actual diagnosis.
   */
  export function redactURL(input: string): string {
    const parsed = URL.parse(input)
    if (!parsed) {
      // Unparseable input still gets the same guarantee: keep everything before
      // the first `?` or `#`, withhold the rest rather than guess at its shape.
      const head = input.split(/[?#]/)[0]
      if (!head) return REDACTED
      return head.length === input.length ? head : `${head}?${REDACTED}`
    }

    parsed.username = ""
    parsed.password = ""
    parsed.hash = ""
    for (const key of [...parsed.searchParams.keys()]) {
      if (VISIBLE_QUERY_PARAMS.has(key.toLowerCase())) continue
      // `set` also collapses repeated keys, so a duplicated credential
      // parameter cannot survive in a later position.
      parsed.searchParams.set(key, REDACTED)
    }
    return parsed.toString()
  }

  /**
   * Detail rows for a persisted error record. Returns an empty list for errors
   * that carry no transport context (aborts, config errors, older records), so
   * callers can append unconditionally.
   *
   * `context` supplies the provider and model for records written before they
   * were recorded in the error itself; the error's own metadata wins.
   */
  export function detail(error: unknown, context?: { providerID?: string; modelID?: string }): string[] {
    const data = isRecord(error) && isRecord(error.data) ? error.data : undefined
    if (!data) return []
    const metadata = isRecord(data.metadata) ? data.metadata : {}

    const provider = string(metadata.providerID) ?? context?.providerID
    const model = string(metadata.modelID) ?? context?.modelID
    const url = string(metadata.url)
    const status = typeof data.statusCode === "number" ? String(data.statusCode) : undefined

    return [
      ...(provider || model ? [row("provider", [provider, model].filter(Boolean).join("/"))] : []),
      ...(url ? [row("request", redactURL(url))] : []),
      ...(status ? [row("status", status)] : []),
    ]
  }

  /**
   * `message` followed by its indented detail rows. Response headers are never
   * included — they are where bearer tokens live.
   */
  export function describe(
    message: string,
    error: unknown,
    context?: { providerID?: string; modelID?: string },
  ): string {
    const rows = detail(error, context)
    if (rows.length === 0) return message
    return [message, ...rows.map((entry) => "  " + entry)].join("\n")
  }

  function row(label: string, value: string) {
    return `${label.padEnd(8)} ${value}`
  }

  function string(value: unknown) {
    return typeof value === "string" && value ? value : undefined
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
  }
}
