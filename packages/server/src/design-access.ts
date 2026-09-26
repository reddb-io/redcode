export * as DesignAccess from "./design-access"

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

export const COOKIE = "design_ticket"
export const LINK_TTL = 10 * 60_000
export const COOKIE_TTL = 12 * 60 * 60_000

/** Embedded servers without a configured password keep links local to this process lifetime. */
export const embeddedSecret = randomBytes(32).toString("base64url")

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

function sign(secret: string, sessionID: string, expires: number) {
  return createHmac("sha256", secret).update(`design:${sessionID}:${expires}`).digest("base64url")
}
