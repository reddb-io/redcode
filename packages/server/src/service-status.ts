export * as Status from "./service-status"

import { ProviderFailure } from "@opencode/core/session/provider-failure"
import { Cause, Effect, Ref } from "effect"

/** What a failed boot tells clients: a short redacted reason and the log file that holds the full cause. */
export type Failure = {
  readonly message?: string
  readonly log?: string
}

export type State =
  | { readonly type: "starting" }
  | { readonly type: "ready" }
  | { readonly type: "stopping" }
  | ({ readonly type: "failed" } & Failure)

export interface Interface {
  readonly current: Effect.Effect<State>
  readonly ready: Effect.Effect<void>
  readonly fail: (failure: Failure) => Effect.Effect<void>
  readonly beginStopping: Effect.Effect<void>
}

export const make = Effect.fnUntraced(function* (options: { readonly initial?: State } = {}) {
  const current = yield* Ref.make(options.initial ?? ({ type: "starting" } satisfies State))
  const beginStopping = Ref.update(current, (status) =>
    status.type === "stopping" ? status : ({ type: "stopping" } satisfies State),
  )

  return {
    current: Ref.get(current),
    ready: Ref.update(current, (status) => (status.type === "starting" ? ({ type: "ready" } satisfies State) : status)),
    fail: (failure: Failure) =>
      Ref.update(current, (status) =>
        status.type === "starting" ? ({ type: "failed", ...failure } satisfies State) : status,
      ),
    beginStopping,
  } satisfies Interface
})

const reasonLimit = 300
const urlPattern = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>]+/gi
const schemePattern = /\b(bearer|basic)\s+[\w.~+\/=-]+/gi
// `name: value` prose ("Unexpected token: }") stays readable; `name=value` and `name:value` are masked.
const secretPattern =
  /\b([\w.-]*(?:api.?key|secret|password|passwd|token|credential|authorization|cookie)[\w.-]*)(\s*=\s*|:(?=\S))("[^"]*"|'[^']*'|[^\s,;&]+)/gi

/** The boot failure's first line, safe to show to clients; the full cause stays in the server log. */
export function reason(cause: Cause.Cause<unknown>) {
  const error = Cause.squash(cause)
  return summarize(error instanceof Error ? error.message || error.name : typeof error === "string" ? error : "")
}

/**
 * Keeps the first non-empty line, strips userinfo, query and fragment from URLs, masks authorization
 * schemes and credential-named assignments, and caps the result so a status response stays small.
 */
export function summarize(text: string) {
  const line = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.length > 0)
  if (line === undefined) return undefined
  const safe = line
    .replace(urlPattern, (url) => ProviderFailure.redactURL(url))
    .replace(schemePattern, "$1 ***")
    .replace(secretPattern, "$1$2***")
  return safe.length > reasonLimit ? safe.slice(0, reasonLimit - 1) + "…" : safe
}
