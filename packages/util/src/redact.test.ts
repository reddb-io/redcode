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

describe("Redact URL helpers", () => {
  test("keeps scheme, host, port and path and drops userinfo, query and fragment", () => {
    expect(Redact.redactURL(`https://admin:${"hunter" + "2"}@db.example.com:8443/a/b?token=x#frag`)).toBe(
      "https://db.example.com:8443/a/b",
    )
    expect(Redact.redactURL("not a url?secret=1")).toBe("not a url")
    expect(Redact.redactURL(`//admin:${"hunter" + "2"}@db.example.com/path?x=1`)).toBe("//db.example.com/path")
    expect(Redact.redactURL("?token=abc")).toBe("__REDACTED__")
    expect(Redact.redactURL("#frag")).toBe("__REDACTED__")
    expect(Redact.redactURLs("see https://a:b@x.example/p?q=1 and http://y.example/#h")).toBe(
      "see https://x.example/p and http://y.example/",
    )
    expect(Redact.placeholder("jwt")).toBe("[redacted:jwt]")
  })
})

describe("Redact.redact decisions", () => {
  test("replaces a long user part without a password, and keeps a short or empty one", () => {
    const credentials = "deploy" + "0123456789abcdefXYZ"
    expect(Redact.redact(`https://${credentials}@api.example.com/x`)).toBe(
      "https://[redacted:url-credentials]@api.example.com/x",
    )
    expect(Redact.redact("https://git@github.com/o/r")).toBe("https://git@github.com/o/r")
    expect(Redact.redact("https://user:@host.example/")).toBe("https://user:@host.example/")
  })

  test("reads comparison and arrow operators as no assignment, and Go's := as one", () => {
    for (const text of [
      'if token == "abcdef12345"',
      "tokens.map(token => tokenize(token))",
      "password =~ /^x/",
      "token::value",
    ])
      expect(Redact.redact(text)).toBe(text)
    expect(Redact.redact(`password := "${"hunter2" + "hunter2"}"`)).toBe('password := "[redacted:password]"')
  })

  test("names the kind a secret-named assignment holds", () => {
    const secret = "s3cr3t" + "Value9"
    const names = [
      ["DB_PASS", "password"],
      ["MYSQL_PWD", "password"],
      ["GPG_PASSPHRASE", "password"],
      ["SSH_PRIVATE_KEY", "private-key"],
      ["REFRESH_TOKEN", "token"],
      ["CLIENT_SECRET", "secret"],
      ["ACCESS_KEY", "api-key"],
      ["DB_CREDENTIALS", "credential"],
      ["PROXY_AUTH", "authorization"],
      ["SESSION_COOKIE", "cookie"],
      ["WEBHOOK_SIGNATURE", "signature"],
    ] as const
    for (const [name, kind] of names) {
      expect(Redact.redact(`${name}=${secret}`)).toBe(`${name}=[redacted:${kind}]`)
      expect(Redact.findSecrets(`${name}=${secret}`)).toEqual([
        { start: name.length + 1, end: name.length + 1 + secret.length, kind, value: secret, confidence: "high" },
      ])
    }
  })

  test("keeps references, types, placeholders and descriptors under secret names", () => {
    const kept = [
      "password=***",
      'api_key: "<your-key>"',
      'token: "xxxx"',
      'password: "..."',
      'password: "•••"',
      'password: "[redacted]"',
      'secret="$' + '{SECRET_VALUE}"',
      'token="{{ .Values.token }}"',
      'password="%DB_PASS%"',
      "api_key=getKey()",
      "token=$TOKEN",
      "password=null",
      "token=true",
      "api_key=config.apiKey",
      "token=GITHUB_TOKEN",
      "password=1234",
      "password: hunter",
      "token_file=/etc/tok",
      "author=jane",
      "keyboard=dvorak1",
    ]
    for (const text of kept) {
      expect(Redact.redact(text)).toBe(text)
      expect(Redact.findSecrets(text)).toEqual([])
    }
    expect(Redact.redact(`password: ${"hunter" + "22"}`)).toBe("password: [redacted:password]")
  })

  test("redacts a quoted random token only when it reads as random", () => {
    const random = ["Ab1Cd2", "Ef3Gh4", "Ij5Kl6", "Mn7Op8", "Qr9St0", "Uv"]
    expect(Redact.redact(`const p = "${random.join("+")}"`)).toBe('const p = "[redacted:secret]"')
    expect(Redact.redact(`const p = "${random.join("/")}"`)).toBe(`const p = "${random.join("/")}"`)
    expect(Redact.redact(`const p = "sha256-${random.join("+")}"`)).toBe(`const p = "sha256-${random.join("+")}"`)
    expect(Redact.redact(`const p = "${random.join("+").toLowerCase()}"`)).toBe(
      `const p = "${random.join("+").toLowerCase()}"`,
    )
  })

  test("reads a capitalized word after Bearer as prose and a mixed-case run as a credential", () => {
    expect(Redact.redact("Send the Bearer Tokens later")).toBe("Send the Bearer Tokens later")
    expect(Redact.redact("x BEARER abcdef" + "GHIJ")).toBe("x BEARER [redacted:authorization]")
    expect(Redact.redact("Authorization: Basic not-base64!")).toBe("Authorization: Basic not-base64!")
  })
})

describe("Redact.redact private keys", () => {
  const begin = pemHeader("BEGIN")
  const end = pemHeader("END")
  const body = `${repeat("MIIEow", 128)}\n${repeat("z9+/", 64)}`

  test("redacts every block and the text between them survives", () => {
    const pem = `${begin}\n${body}\n${end}`
    expect(Redact.redact(`${pem}\nmiddle\n${pem}`)).toBe("[redacted:private-key]\nmiddle\n[redacted:private-key]")
    expect(Redact.findSecrets(`${pem}\nmiddle\n${pem}`).map((item) => item.kind)).toEqual([
      "private-key",
      "private-key",
    ])
  })

  test("runs a block cut off before its end line over its base64 lines, escaped or not", () => {
    expect(Redact.redact(`key: ${begin}\n${body} and more`)).toBe("key: [redacted:private-key] and more")
    const escaped = `{"k":"${begin}\\n${body.replace("\n", "\\n")}"}`
    expect(Redact.redact(escaped)).toBe('{"k":"[redacted:private-key]"}')
    expect(Redact.findSecrets(escaped)).toEqual([
      {
        start: 6,
        end: escaped.length - 2,
        kind: "private-key",
        value: escaped.slice(6, -2),
        confidence: "high",
      },
    ])
  })

  test("reads an end line past the longest key, or without closing dashes, as no end", () => {
    expect(Redact.redact(`${begin}\n${repeat("MIIEow", 17_000)}\n${end}`)).toBe(`[redacted:private-key]${end}`)
    const truncated = `${begin}\nMIIB${repeat("q", 64)}\n-----END RSA ${"PRIVATE"} ${"KEY"}`
    expect(Redact.redact(truncated)).toBe(`[redacted:private-key]RSA ${"PRIVATE"} ${"KEY"}`)
  })

  test("leaves a certificate and a BEGIN line without a label end alone", () => {
    const certificate = `-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIU\n-----END CERTIFICATE-----`
    expect(Redact.redact(certificate)).toBe(certificate)
    expect(Redact.redact("-----BEGIN nothing here")).toBe("-----BEGIN nothing here")
    expect(Redact.redact(`${certificate}\n${begin}\n${body}\n${end}`)).toBe(`${certificate}\n[redacted:private-key]`)
  })
})

describe("Redact.redact over the scanning chunk size", () => {
  const key = "ghp" + "_" + repeat("A1b", 36)

  test("cuts at the limit when no whitespace is near and still finds a token past it", () => {
    const text = `${",".repeat(20_000)}${key}${",".repeat(20_000)}`
    expect(Redact.redact(text)).toBe(`${",".repeat(20_000)}[redacted:github-token]${",".repeat(20_000)}`)
    expect(Redact.findSecrets(text).map((item) => [item.start, item.end])).toEqual([[20_000, 20_000 + key.length]])
  })

  test("cuts after a tab", () => {
    const text = `${"a\t".repeat(10_000)}${key}`
    expect(Redact.redact(text)).toBe(`${"a\t".repeat(10_000)}[redacted:github-token]`)
    expect(Redact.findSecrets(text)[0]?.start).toBe(20_000)
  })
})

describe("Redact.redactDeep", () => {
  const key = "ghp" + "_" + repeat("A1b", 36)
  const nest = (depth: number, leaf: unknown): unknown => (depth === 0 ? leaf : { next: nest(depth - 1, leaf) })

  test("redacts strings in arrays and at the top level, and leaves other values", () => {
    expect(Redact.redactDeep(["plain", key, [key]])).toEqual([
      "plain",
      "[redacted:github-token]",
      ["[redacted:github-token]"],
    ])
    expect(Redact.redactDeep(key)).toBe("[redacted:github-token]")
    expect(Redact.redactDeep(null)).toBeNull()
    expect(Redact.redactDeep(42)).toBe(42)
    expect(Redact.redactDeep(undefined)).toBeUndefined()
  })

  test("returns a value that is not plain data as it is, and reads an object without a prototype", () => {
    const date = new Date(0)
    expect(Redact.redactDeep(date)).toBe(date)
    const bare: Record<string, string> = Object.create(null)
    bare.password = "hunter" + "2x"
    expect(Redact.redactDeep(bare)).toEqual({ password: "[redacted:password]" })
  })

  test("withholds only a plausible literal under a secret-named key", () => {
    expect(
      Redact.redactDeep({
        password: "$" + "{DB_PASSWORD}",
        token: 12_345,
        tokenFile: "/run/secrets/token",
        apiKeys: [`x ${key}`],
      }),
    ).toEqual({
      password: "$" + "{DB_PASSWORD}",
      token: 12_345,
      tokenFile: "/run/secrets/token",
      apiKeys: ["x [redacted:github-token]"],
    })
  })

  test("reaches nested values and stops descending past its depth limit", () => {
    expect(Redact.redactDeep(nest(10, { note: `export TOKEN=${"abc" + "123"}` }))).toEqual(
      nest(10, { note: "export TOKEN=[redacted:token]" }),
    )
    const deep = nest(40, { note: "benign" })
    expect(Redact.redactDeep(deep)).toEqual(deep)
  })
})

describe("Redact properties over every token family", () => {
  const families = [
    { kind: "openai-key", value: "sk-" + "proj-" + repeat("Ab3", 45) },
    { kind: "anthropic-key", value: "sk-" + "ant-" + "api03-" + repeat("Xy9_", 60) },
    { kind: "openrouter-key", value: "sk-" + "or-" + "v1-" + repeat("0f", 64) },
    { kind: "github-token", value: "ghp" + "_" + repeat("A1b", 36) },
    { kind: "github-token", value: "github" + "_pat_" + repeat("11ABC", 82) },
    { kind: "gitlab-token", value: "glpat" + "-" + repeat("Zx8", 20) },
    { kind: "aws-access-key", value: "AKIA" + "ABCDEFGH23456789" },
    { kind: "google-api-key", value: "AIza" + "Sy" + repeat("B1c", 33) },
    { kind: "slack-token", value: "xoxb" + "-1234-5678-" + repeat("abcDEF", 18) },
    { kind: "stripe-key", value: "sk" + "_live_" + repeat("4eC39Hq", 28) },
    { kind: "npm-token", value: "npm" + "_" + repeat("aB3", 36) },
    {
      kind: "jwt",
      value: `${"eyJ" + "hbGciOiJIUzI1NiJ9"}.${"eyJ" + "zdWIiOiIxMjM0In0"}.${repeat("Sf1Kx_wR-J", 43)}`,
    },
  ]
  const contexts = [
    (value: string) => value,
    (value: string) => `export X_TOKEN=${value}`,
    (value: string) => `{"token": "${value}"}`,
    (value: string) => `curl -H 'Authorization: Bearer ${value}'`,
    (value: string) => `https://api.example.com/?token=${value}`,
    (value: string) => `${value} and again ${value}`,
  ]

  for (const family of families)
    test(`${family.kind} never survives redaction, redacts once, and is found whole and high`, () => {
      for (const context of contexts) {
        const text = context(family.value)
        const redacted = Redact.redact(text)
        expect(redacted).not.toContain(family.value)
        expect(redacted).toContain(`[redacted:${family.kind}]`)
        expect(Redact.redact(redacted)).toBe(redacted)
        expect(Redact.containsSecret(text)).toBe(true)
        const found = Redact.findSecrets(text)
        expect(found.some((item) => item.value === family.value && item.kind === family.kind)).toBe(true)
        expect(found.filter((item) => item.value === family.value).every((item) => item.confidence === "high")).toBe(
          true,
        )
        expect(found.every((item) => text.slice(item.start, item.end) === item.value)).toBe(true)
        expect(found.every((item, index) => index === 0 || found[index - 1].end <= item.start)).toBe(true)
      }
    })
})
