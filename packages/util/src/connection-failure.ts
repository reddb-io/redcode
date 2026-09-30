export type ConnectionFailure = {
  readonly kind: "credential" | "status" | "timeout" | "unreachable" | "unknown"
  /** The HTTP status the check observed, when any layer reported one. */
  readonly status: number | undefined
  /** The original failure message, shown under the reason. */
  readonly detail: string
}

const credential = [
  "unauthorized",
  "unauthorised",
  "forbidden",
  "invalid api key",
  "invalid_api_key",
  "incorrect api key",
  "authentication",
  "missing api key",
]
const timeout = ["timeouterror", "timed out", "timeout", "etimedout"]
const unreachable = [
  "econnrefused",
  "enotfound",
  "eai_again",
  "econnreset",
  "ehostunreach",
  "enetunreach",
  "failed to fetch",
  "fetch failed",
  "unable to connect",
  "network request failed",
  "load failed",
  "socket hang up",
]

/**
 * Sorts a failed reasoning connection check (a generate call or an S1 probe) into the reason a setup
 * screen shows next to Retry: a rejected credential, an HTTP status, no answer in time, or an
 * unreachable address. Generated clients wrap fetch failures as `ClientError("Transport", { cause })`
 * and the runtime puts network detail in `code`, so every layer of the cause chain is read.
 */
export function connectionFailure(error: unknown): ConnectionFailure {
  const chain = causes(error, 0)
  const text = chain.map(describe).join(" ").toLowerCase()
  const status =
    chain.map(statusOf).find((value) => value !== undefined) ??
    matchedStatus(text.match(/(?:http|status)[\s:(]*([1-5]\d{2})\b/)?.[1])
  const detail = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  if (status === 401 || status === 403 || credential.some((item) => text.includes(item)))
    return { kind: "credential", status, detail }
  if (timeout.some((item) => text.includes(item))) return { kind: "timeout", status, detail }
  if (status !== undefined) return { kind: "status", status, detail }
  if (
    unreachable.some((item) => text.includes(item)) ||
    chain.some((item) => item instanceof Error && "reason" in item && item.reason === "Transport")
  )
    return { kind: "unreachable", status, detail }
  return { kind: "unknown", status, detail }
}

/** Runs the checks in order and stops at the first failure, returning its role and reason; undefined when all pass. */
export function firstConnectionFailure<Role>(
  checks: readonly { readonly role: Role; readonly run: () => Promise<unknown> }[],
) {
  return checks.reduce<Promise<{ role: Role; failure: ConnectionFailure } | undefined>>(
    (previous, check) =>
      previous.then(
        (earlier) =>
          earlier ??
          check.run().then(
            () => undefined,
            (error: unknown) => ({ role: check.role, failure: connectionFailure(error) }),
          ),
      ),
    Promise.resolve(undefined),
  )
}

function causes(error: unknown, depth: number): unknown[] {
  if (error === undefined || error === null || depth >= 5) return []
  return [error, ...(typeof error === "object" && "cause" in error ? causes(error.cause, depth + 1) : [])]
}

function describe(value: unknown) {
  if (typeof value === "string") return value
  if (!(value instanceof Error)) return ""
  return `${value.name} ${value.message} ${"code" in value && typeof value.code === "string" ? value.code : ""}`
}

function statusOf(value: unknown) {
  if (typeof value !== "object" || value === null || !("status" in value)) return undefined
  return typeof value.status === "number" ? value.status : undefined
}

function matchedStatus(value: string | undefined) {
  return value === undefined ? undefined : Number(value)
}
