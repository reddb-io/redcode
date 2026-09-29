import { describe, expect, test } from "bun:test"
import { Redact } from "./redact.js"

// Every fixture is assembled from parts so no secret scanner mistakes it for a real credential.
const repeat = (unit: string, length: number) => unit.repeat(Math.ceil(length / unit.length)).slice(0, length)
const pemHeader = (edge: "BEGIN" | "END") => `-----${edge} RSA ${"PRIVATE"} ${"KEY"}-----`
const githubToken = "ghp" + "_" + repeat("A1b", 36)

const summary = (text: string) =>
  Redact.findSecrets(text).map((item) => ({ kind: item.kind, value: item.value, confidence: item.confidence }))

describe("findSecrets", () => {
  test("reports known token families in the text's own offsets", () => {
    const text = `push with ${githubToken} now`
    const [found] = Redact.findSecrets(text)
    expect(found).toEqual({
      start: 10,
      end: 10 + githubToken.length,
      kind: "github-token",
      value: githubToken,
      confidence: "high",
    })
    expect(text.slice(found.start, found.end)).toBe(found.value)
  })

  test("reports PEM private keys, URL passwords, JWTs and secret-named assignments as high", () => {
    const pem = `${pemHeader("BEGIN")}\nMIIB${repeat("q", 64)}\n${pemHeader("END")}`
    const password = "hunter" + "2hunter2"
    const jwt = "eyJ" + repeat("a", 12) + ".eyJ" + repeat("b", 12) + "." + repeat("c", 12)
    const apiKey = "abc" + "123def456"
    const jsonPassword = "s3cr" + "etvalue9"
    const text = [
      `key:\n${pem}`,
      `postgres://admin:${password}@db.local/app`,
      `token ${jwt}`,
      `API_KEY=${apiKey}`,
      `{"password": "${jsonPassword}"}`,
    ].join("\n")
    expect(summary(text)).toEqual([
      { kind: "private-key", value: pem, confidence: "high" },
      { kind: "password", value: password, confidence: "high" },
      { kind: "jwt", value: jwt, confidence: "high" },
      { kind: "api-key", value: apiKey, confidence: "high" },
      { kind: "password", value: jsonPassword, confidence: "high" },
    ])
  })

  test("reports the entropy heuristic and Authorization credentials as low", () => {
    const checksum = repeat("aB1", 36)
    const bearer = "abc.def" + "-123"
    expect(summary(`checksum=${checksum}\nAuthorization: Bearer ${bearer}`)).toEqual([
      { kind: "secret", value: checksum, confidence: "low" },
      { kind: "authorization", value: bearer, confidence: "low" },
    ])
  })

  test("lets the token family win over the secret name around it", () => {
    expect(summary(`GITHUB_TOKEN=${githubToken}`)).toEqual([
      { kind: "github-token", value: githubToken, confidence: "high" },
    ])
  })

  test("keeps offsets of the original text past the scanning chunk size", () => {
    const text = `${"word ".repeat(5_000)}${githubToken} and ${"more ".repeat(1_000)}API_KEY=${"abc" + "123def456"}`
    const found = Redact.findSecrets(text)
    expect(found.map((item) => item.start)).toEqual([text.indexOf(githubToken), text.indexOf("abc123def456")])
    expect(found.every((item) => text.slice(item.start, item.end) === item.value)).toBe(true)
  })

  test("finds nothing in ordinary text and leaves redact unchanged", () => {
    const text = "Fix the failing tests in src/app.ts and run bun test"
    expect(Redact.findSecrets(text)).toEqual([])
    expect(Redact.redact(text)).toBe(text)
  })
})
