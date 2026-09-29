export * as DesignAccess from "./design-access"

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { type CorsOptions, isAllowedRequestOrigin } from "./cors"

export const COOKIE = "design_ticket"
export const LINK_TTL = 10 * 60_000
export const COOKIE_TTL = 12 * 60 * 60_000

/** Embedded servers without a configured password keep links local to this process lifetime. */
export const embeddedSecret = (() => {
  let value: string | undefined
  return () => (value ??= randomBytes(32).toString("base64url"))
})()

export function ticket(secret: string, sessionID: string, ttl = LINK_TTL, now = Date.now()) {
  const expires = now + ttl
  return `${expires}.${sign(secret, sessionID, expires)}`
}

export function verify(secret: string, sessionID: string, value: string | undefined, now = Date.now()) {
  if (!value) return false
  const [expires, signature] = value.split(".")
  const time = Number(expires)
  if (!signature || !Number.isSafeInteger(time) || time < now) return false
  const expected = Buffer.from(sign(secret, sessionID, time))
  const actual = Buffer.from(signature)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/**
 * The origin a review link points at: the address the client reached this server at, so a client on another
 * device gets a link it can open and a local client keeps loopback. A wildcard Host (a client that connected
 * to the bind address) becomes loopback, which browsers open and `0.0.0.0` is not.
 */
export function reviewOrigin(host: string | undefined) {
  const url = URL.parse(`http://${host || "localhost"}`)
  if (!url) return "http://localhost"
  if (url.hostname === "0.0.0.0" || url.hostname === "[::]") url.hostname = "127.0.0.1"
  return url.origin
}

/**
 * Why a launch claim is refused, or nothing when it may go on. Claims need server credentials, which a review
 * cookie never grants and a session cookie grants only same-origin. A credentialed client on another origin
 * the server's CORS policy admits (the desktop and development web app) may claim too: a claim only moves the
 * one-tab debounce and returns the ticketed link that `GET /link` already gives those origins. Other Design
 * writes keep the same-host rule, since a review cookie can authorize them.
 */
export function launchRefusal(input: {
  readonly trusted: boolean
  readonly origin: string | undefined
  readonly host: string | undefined
  readonly contentType: string | undefined
  readonly cors?: CorsOptions
}) {
  if (!input.trusted) return { status: 401, message: "Server authorization is required to open a review" }
  if (!isAllowedRequestOrigin(input.origin, input.host, input.cors))
    return { status: 403, message: "Design refuses launches from this origin" }
  if (!input.contentType?.startsWith("application/json")) return { status: 403, message: "Design writes must be JSON" }
  return undefined
}

function sign(secret: string, sessionID: string, expires: number) {
  return createHmac("sha256", secret).update(`design:${sessionID}:${expires}`).digest("base64url")
}
