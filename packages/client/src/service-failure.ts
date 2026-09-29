/** What a background service that could not start reports about its boot failure. */
export type ServiceFailure = {
  /** Short, redacted reason taken from the first line of the boot error. */
  readonly message?: string
  /** Log file that holds the full boot error. */
  readonly log?: string
}

/** Error text for a background service that could not start: the reason, where to read more, and how to recover. */
export function failedToStart(failure: ServiceFailure = {}) {
  if (failure.message === undefined && failure.log === undefined) return "Background service failed to start"
  return [
    failure.message === undefined
      ? "Background service failed to start"
      : `Background service failed to start: ${failure.message}`,
    failure.log === undefined ? undefined : `Details are in ${failure.log}`,
    "Run `redcode service restart` after fixing the cause.",
  ]
    .filter((line) => line !== undefined)
    .join("\n")
}

/** Reads the optional failure details from a failed service's info response. */
export function decodeFailure(body: unknown): ServiceFailure | undefined {
  if (typeof body !== "object" || body === null || !("failure" in body)) return undefined
  const failure = body.failure
  if (typeof failure !== "object" || failure === null) return undefined
  return {
    message: "message" in failure && typeof failure.message === "string" ? failure.message : undefined,
    log: "log" in failure && typeof failure.log === "string" ? failure.log : undefined,
  }
}
