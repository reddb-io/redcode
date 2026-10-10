export * as ConsoleCrypto from "./crypto.js"

import { timingSafeEqual } from "node:crypto"

export function token(prefix: string) {
  return prefix + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")
}

export async function digest(value: string) {
  return Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("hex")
}

// Web Crypto keeps the persisted format usable on Bun, Node and worker runtimes.
// https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
export async function password(value: string, salt = crypto.getRandomValues(new Uint8Array(32))) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(value), "PBKDF2", false, ["deriveBits"])
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 600_000 }, key, 256)
  return `pbkdf2-sha256:600000:${Buffer.from(salt).toString("hex")}:${Buffer.from(bits).toString("hex")}`
}

export async function verify(value: string, stored: string) {
  const fields = stored.split(":")
  if (fields.length !== 4 || fields[0] !== "pbkdf2-sha256" || fields[1] !== "600000") return false
  const candidate = await password(value, Buffer.from(fields[2], "hex"))
  return equal(candidate, stored)
}

export function equal(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
