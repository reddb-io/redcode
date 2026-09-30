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

describe("findSecrets decisions", () => {
  test("reports a long user part and credential query parameters as high, and skips redacted ones", () => {
    const credentials = "deploy" + "0123456789abcdefXYZ"
    const text = `curl https://${credentials}@h.example/p?key=abcd1234&sig=zzzz&access_token=[redacted:token]`
    expect(summary(text)).toEqual([
      { kind: "url-credentials", value: credentials, confidence: "high" },
      { kind: "api-key", value: "abcd1234", confidence: "high" },
      { kind: "signature", value: "zzzz", confidence: "high" },
    ])
    expect(Redact.findSecrets("https://user:@host.example/")).toEqual([])
    expect(Redact.findSecrets("https://git@github.com/o/r")).toEqual([])
  })

  test("reports a mixed-case Bearer credential as low and Basic prose as nothing", () => {
    expect(summary("x BEARER abcdef" + "GHIJ")).toEqual([
      { kind: "authorization", value: "abcdefGHIJ", confidence: "low" },
    ])
    expect(Redact.findSecrets("Authorization: Basic not-base64!")).toEqual([])
    expect(Redact.findSecrets("Send the Bearer Tokens later")).toEqual([])
  })

  test("reports a quoted random token as low, in the text's offsets", () => {
    const random = ["Ab1Cd2", "Ef3Gh4", "Ij5Kl6", "Mn7Op8", "Qr9St0", "Uv"].join("+")
    const text = `const p = "${random}"`
    expect(Redact.findSecrets(text)).toEqual([
      { start: 11, end: 11 + random.length, kind: "secret", value: random, confidence: "low" },
    ])
  })

  test("drops every later finding that meets an earlier one, however many came before", () => {
    const first = "ghp" + "_" + repeat("A1b", 36)
    const second = "ghp" + "_" + repeat("C2d", 36)
    const third = "ghp" + "_" + repeat("E3f", 36)
    const text = `A=${first} B=${second} GITHUB_TOKEN=${third}`
    expect(summary(text)).toEqual([
      { kind: "github-token", value: first, confidence: "high" },
      { kind: "github-token", value: second, confidence: "high" },
      { kind: "github-token", value: third, confidence: "high" },
    ])
  })

  test("gives nothing high for what only the heuristics see", () => {
    const text = `checksum=${repeat("aB1", 36)}\nx BEARER abcdef${"GHIJ"}\nconst p = "${repeat("Ab1Cd2+", 40)}"`
    const found = Redact.findSecrets(text)
    expect(found.length).toBe(3)
    expect(found.every((item) => item.confidence === "low")).toBe(true)
  })
})
