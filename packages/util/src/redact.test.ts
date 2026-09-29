import { describe, expect, test } from "bun:test"
import { Redact } from "./redact.js"

// Every fixture is assembled from parts so no secret scanner mistakes it for a real credential.
const repeat = (unit: string, length: number) => unit.repeat(Math.ceil(length / unit.length)).slice(0, length)
const pemHeader = (edge: "BEGIN" | "END") => `-----${edge} RSA ${"PRIVATE"} ${"KEY"}-----`

const secrets = [
  { family: "OpenAI key", text: `key ${"sk-" + "proj-" + repeat("Ab3", 45)}`, redacted: "key [redacted:openai-key]" },
  {
    family: "Anthropic key",
    text: "sk-" + "ant-" + "api03-" + repeat("Xy9_", 60),
    redacted: "[redacted:anthropic-key]",
  },
  { family: "OpenRouter key", text: "sk-" + "or-" + "v1-" + repeat("0f", 64), redacted: "[redacted:openrouter-key]" },
  { family: "GitHub classic token", text: "ghp" + "_" + repeat("A1b", 36), redacted: "[redacted:github-token]" },
  { family: "GitHub OAuth token", text: "gho" + "_" + repeat("Q7z", 36), redacted: "[redacted:github-token]" },
  { family: "GitHub server token", text: "ghs" + "_" + repeat("m4K", 36), redacted: "[redacted:github-token]" },
  {
    family: "GitHub fine-grained token",
    text: "github" + "_pat_" + repeat("11ABC", 82),
    redacted: "[redacted:github-token]",
  },
  { family: "GitLab token", text: "glpat" + "-" + repeat("Zx8", 20), redacted: "[redacted:gitlab-token]" },
  { family: "AWS access key id", text: "AKIA" + "ABCDEFGH23456789", redacted: "[redacted:aws-access-key]" },
  { family: "AWS session key id", text: "ASIA" + "ZYXWVUTS98765432", redacted: "[redacted:aws-access-key]" },
  {
    family: "AWS secret key",
    text: `aws_secret_access_key = ${repeat("wJalrXUtnFEMI/K7MDENG+bPxRfiCY", 40)}`,
    redacted: "aws_secret_access_key = [redacted:secret]",
  },
  { family: "Google API key", text: "AIza" + "Sy" + repeat("B1c", 33), redacted: "[redacted:google-api-key]" },
  {
    family: "Slack token",
    text: "xoxb" + "-1234-5678-" + repeat("abcDEF", 18),
    redacted: "[redacted:slack-token]",
  },
  { family: "Stripe secret key", text: "sk" + "_live_" + repeat("4eC39Hq", 28), redacted: "[redacted:stripe-key]" },
  { family: "Stripe restricted key", text: "rk" + "_live_" + repeat("9Tb2mXw", 28), redacted: "[redacted:stripe-key]" },
  { family: "npm token", text: "npm" + "_" + repeat("aB3", 36), redacted: "[redacted:npm-token]" },
  {
    family: "JWT",
    text: `session ${"eyJ" + "hbGciOiJIUzI1NiJ9"}.${"eyJ" + "zdWIiOiIxMjM0In0"}.${repeat("Sf1Kx_wR-J", 43)}`,
    redacted: "session [redacted:jwt]",
  },
  {
    family: "PEM private key",
    text: `${pemHeader("BEGIN")}\n${repeat("MIIEow", 64)}\n${repeat("z9+/", 64)}\n${pemHeader("END")}\nafter`,
    redacted: "[redacted:private-key]\nafter",
  },
  {
    family: "Bearer header",
    text: `curl -H 'Authorization: Bearer ${"abc." + "def-ghi123"}'`,
    redacted: "curl -H 'Authorization: Bearer [redacted:authorization]'",
  },
  {
    family: "Basic header",
    text: "Authorization: Basic " + "dXNlcjpwYXNz" + "d29yZA==",
    redacted: "Authorization: Basic [redacted:authorization]",
  },
  {
    family: "URL userinfo and credential query parameters",
    text: `https://admin:${"hunter" + "2"}@db.internal:5432/app?token=${"abc" + "123"}&page=2&sig=${"zz" + "z"}`,
    redacted:
      "https://admin:[redacted:password]@db.internal:5432/app?token=[redacted:token]&page=2&sig=[redacted:signature]",
  },
  {
    family: "URL api key parameter",
    text: `https://maps.example.com/api?key=${"k1" + "b2c3"}&q=x`,
    redacted: "https://maps.example.com/api?key=[redacted:api-key]&q=x",
  },
  {
    family: "env assignment",
    text: `export OPENAI_API_KEY=${"abc123" + "xyz"}`,
    redacted: "export OPENAI_API_KEY=[redacted:api-key]",
  },
  {
    family: "JSON assignment",
    text: `{"password": "${"hunter" + "2"}", "api_key":"${"k-" + "1234"}", "max_tokens": 4096}`,
    redacted: '{"password": "[redacted:password]", "api_key":"[redacted:api-key]", "max_tokens": 4096}',
  },
  { family: "YAML assignment", text: `db_password: ${"s3cr3t" + "!"}`, redacted: "db_password: [redacted:password]" },
  {
    family: "command-line flag",
    text: `--password=${"hunter" + "2"} --user bob`,
    redacted: "--password=[redacted:password] --user bob",
  },
  { family: "client secret", text: `clientSecret: '${"x7" + "Q-p"}'`, redacted: "clientSecret: '[redacted:secret]'" },
  {
    family: "quoted high-entropy value",
    text: `const x = "${"aB3dE5fG7hJ9kL1m" + "N3pQ5rS7tU9vW1xY"}"`,
    redacted: 'const x = "[redacted:secret]"',
  },
  {
    family: "Azure connection string",
    text: `AccountKey=${repeat("abcDEF123+/", 44)}==;EndpointSuffix=core.windows.net`,
    redacted: "AccountKey=[redacted:api-key];EndpointSuffix=core.windows.net",
  },
  {
    family: "Cloudflare token",
    text: `CLOUDFLARE_API_TOKEN=${repeat("0a1b2c", 40)}`,
    redacted: "CLOUDFLARE_API_TOKEN=[redacted:token]",
  },
]

const kept = [
  "Edit packages/core/src/session/compaction.ts:234 and ./src/main.ts, then run `bun test`.",
  "Reverted 3f9a0c1d2e4b5a6978c0d1e2f3a4b5c6d7e8f901 on main.",
  "Session 550e8400-e29b-41d4-a716-446655440000 failed.",
  "Unexpected token: } in JSON",
  "O usuário pediu para corrigir o erro de autenticação antes do deploy.",
  "認証トークンの期限が切れています。再ログインしてください。",
  "Пароль не нужен, используйте ключ из настроек.",
  "请把密钥轮换一下，然后重新部署。",
  "const token = process.env.GITHUB_TOKEN; const apiKey = getKey(); password: string",
  "function handleUserAuthenticationCallbackResponse2() {}",
  `<img src="data:image/png;base64,${repeat("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB", 2_000)}">`,
  `<img src="data:image/png;base64,${repeat("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB", 96)}==">`,
  "Bearer tokens and Basic set-up are fine. Token: expired",
  `integrity: sha512-${repeat("AbC1dEf2GhI3jKl4MnO5pQr6StU7vWx8YzA9", 86)}==`,
  "key: menu.title",
  "max_tokens=4096 token_count: 12 password_min_length: 8",
  "ssh://git@github.com/owner/repo.git",
]

describe("Redact.redact", () => {
  for (const secret of secrets)
    test(`replaces the value of a secret with its kind: ${secret.family}`, () => {
      expect(Redact.redact(secret.text)).toBe(secret.redacted)
      expect(Redact.containsSecret(secret.text)).toBe(true)
      // Redacted text stays as it is, so a checkpoint redacted again on every read never changes.
      expect(Redact.redact(secret.redacted)).toBe(secret.redacted)
    })

  test("leaves paths, hashes, ids, code, data URLs and prose in any script unchanged", () => {
    for (const text of kept) {
      expect(Redact.redact(text)).toBe(text)
      expect(Redact.containsSecret(text)).toBe(false)
    }
  })

  test("redacts a secret beyond the first chunk of a long text", () => {
    const key = "ghp" + "_" + repeat("A1b", 36)
    const text = `${"lorem ipsum ".repeat(5_000)}${key} ${"dolor sit ".repeat(5_000)}`
    const redacted = Redact.redact(text)
    expect(redacted).not.toContain(key)
    expect(redacted).toContain("[redacted:github-token]")
    expect(redacted.length).toBe(text.length - key.length + "[redacted:github-token]".length)
  })

  test("stays linear on a megabyte of adversarial input", () => {
    const units = [
      "a-",
      "a:",
      "x=",
      "?a=",
      "a.",
      '"',
      '"a":',
      "token=$",
      "sk-",
      "eyJa.",
      "Bearer ",
      "https://",
      "-----BEGIN ",
      `${pemHeader("BEGIN")}`,
      "password=",
      `'${repeat("A1b", 600)}`,
    ]
    for (const unit of units) {
      const text = unit.repeat(Math.ceil(1_000_000 / unit.length))
      const started = performance.now()
      Redact.redact(text)
      expect(performance.now() - started).toBeLessThan(3_000)
    }
  })
})

test("Redact.redactDeep withholds strings under secret-named keys and redacts every other string", () => {
  expect(
    Redact.redactDeep({
      password: "hunter" + "2",
      nested: [{ command: `export TOKEN=${"abc" + "123"}` }],
      filePath: "/project/src/main.ts",
      count: 3,
    }),
  ).toEqual({
    password: "[redacted:password]",
    nested: [{ command: "export TOKEN=[redacted:token]" }],
    filePath: "/project/src/main.ts",
    count: 3,
  })
})
