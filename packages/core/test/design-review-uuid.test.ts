import { expect, test } from "bun:test"
import { DesignPage } from "@opencode/core/design/ui/page"

/**
 * The review page is a plain LAN HTTP page, which is not a secure context: `crypto.randomUUID` is
 * absent there and only `getRandomValues` exists. The page must build its identifiers without it.
 */
const page = DesignPage.review("ses_review_uuid", "/design/session/ses_review_uuid/review")

/** The uuid helper as the page ships it, taken from the serialized page itself. */
const shipped = (() => {
  const start = page.indexOf("const uuid = () => {")
  const end = page.indexOf("copy = { ...options.copy }", start)
  if (start < 0 || end < 0) throw new Error("the review page no longer ships the uuid helper")
  return page.slice(start, end).trimEnd().replace(/,$/, "")
})()

const build = (crypto: unknown) => new Function("crypto", `${shipped}\nreturn uuid`)(crypto) as () => string

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test("the page only reads crypto.randomUUID through the guarded helper", () => {
  // Every mention sits inside the helper's feature check; none is called directly elsewhere.
  const occurrences = page.split("crypto.randomUUID").length - 1
  expect(occurrences).toBe(2)
  expect(shipped).toContain('if (typeof crypto.randomUUID === "function")')
})

test("without crypto.randomUUID the fallback still returns a version 4 identifier", () => {
  let calls = 0
  const uuid = build({
    getRandomValues: <T extends Uint8Array>(bytes: T) => {
      for (let index = 0; index < bytes.length; index++) bytes[index] = index * 7 + calls
      calls++
      return bytes
    },
  })
  const ids = [uuid(), uuid()]
  for (const id of ids) expect(id).toMatch(V4)
  // Random bytes, not a constant: two identifiers differ.
  expect(ids[0]).not.toBe(ids[1])
  expect(calls).toBe(2)
})

test("a browser with crypto.randomUUID keeps using it", () => {
  const uuid = build({ randomUUID: () => "11111111-2222-4333-8444-555555555555" })
  expect(uuid()).toBe("11111111-2222-4333-8444-555555555555")
})
