import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Base64 } from "../src/prompt.js"

test("Base64 keeps its wire pattern and accepts every padding form", () => {
  const decode = Schema.decodeUnknownSync(Base64)
  for (const input of ["", "AAAA", "AA==", "AAA=", "+/8=", "YWJjZA=="]) expect(decode(input)).toBe(input)
  expect(Schema.toJsonSchemaDocument(Base64).definitions["Prompt.Base64"]).toMatchObject({
    type: "string",
    pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
  })
})

test("Base64 rejects truncated, misplaced-padding and whitespace inputs", () => {
  const valid = Schema.is(Base64)
  for (const input of [
    "A",
    "AA",
    "AAA",
    "A===",
    "AAA==",
    "AA=A",
    "=AAA",
    "AAAA=",
    "AA-_",
    "AAAA\n",
    "AAA\n",
    "AA=\r",
    "AAA\u2028",
    "AAA\u2029",
    "AA==\r\n",
    "AA AA",
  ])
    expect(valid(input)).toBe(false)
})

test("Base64 validates a multi-megabyte attachment and rejects invalid tails", () => {
  const encoded = Buffer.alloc(5 * 1024 * 1024, 255).toString("base64")
  const valid = Schema.is(Base64)
  expect(valid(encoded)).toBe(true)
  expect(valid(`${encoded.slice(0, -1)}!`)).toBe(false)
  expect(valid(encoded.slice(0, -1))).toBe(false)
})
