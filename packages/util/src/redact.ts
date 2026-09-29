export * as Redact from "./redact.js"

/**
 * Pattern-based secret redaction for text that becomes durable derived output: compaction checkpoints, session titles
 * and failure reasons. A secret becomes `[redacted:<kind>]`, which keeps what it was but not its value, and redacting
 * redacted text changes nothing. Every pattern bounds its repetition and text is scanned in chunks, so the cost stays
 * linear in the input whatever it holds.
 */

const MARK = "[redacted:"
/** The most text one pattern pass scans at once. */
const CHUNK = 16_384
/** How far back from a chunk's end a line break or space is looked for, so a chunk does not cut a token in two. */
const SPLIT_WINDOW = 2_048
const REDACTED_URL = "__REDACTED__"
const PEM_BEGIN = "-----BEGIN "
const PEM_END = "-----END "
/** Longer than any real PEM private key block. */
const PEM_MAX = 16_384

export const placeholder = (kind: string) => `${MARK}${kind}]`

/** `text` with every recognized secret replaced by its kind placeholder. */
export function redact(text: string) {
  return split(redactPrivateKeys(text))
    .map((chunk) => PASSES.reduce((current, pass) => pass(current), chunk))
    .join("")
}

export const containsSecret = (text: string) => redact(text) !== text

/** `redact` over every string of a JSON-like value; a string under a secret-named key is withheld whole. */
export function redactDeep(value: unknown): unknown {
  return deep(value, 0)
}

/**
 * Keeps scheme, host, port and path, which are the diagnosis, and drops userinfo, the query string and the fragment,
 * which is where keys and signatures travel.
 */
export function redactURL(input: string) {
  const parsed = URL.parse(input)
  if (!parsed) {
    // Unparseable input keeps the same guarantee: nothing after the first `?` or `#` survives.
    const head = input.split(/[?#]/)[0]
    if (!head) return REDACTED_URL
    return head.replace(/\/\/[^/@\s]*@/, "//")
  }
  parsed.username = ""
  parsed.password = ""
  parsed.search = ""
  parsed.hash = ""
  return parsed.toString()
}

/** Every URL in `text` through `redactURL`, for diagnostics where a query string carries nothing worth keeping. */
export const redactURLs = (text: string) => text.replace(URL_PATTERN, (url) => redactURL(url))

export type Confidence = "high" | "low"

/** One secret in the scanned text: `text.slice(start, end) === value`. */
export interface Finding {
  readonly start: number
  readonly end: number
  readonly kind: string
  readonly value: string
  readonly confidence: Confidence
}

/**
 * Where `redact` would act, in the original text's offsets, sorted and never overlapping; as in `redact`, the
 * earlier rule wins. High confidence covers known token families, PEM private keys, URL passwords and credential
 * query parameters, JWTs and literal values under secret names. Low confidence covers `Authorization` credentials
 * and the entropy heuristic, which also matches some hashes and identifiers, so a caller that changes what the user
 * asked for should act only on high findings.
 */
export function findSecrets(text: string): Finding[] {
  let findings: Finding[] = privateKeyBlocks(text).map((block) => ({
    ...block,
    kind: "private-key",
    value: text.slice(block.start, block.end),
    confidence: "high" as const,
  }))
  let offset = 0
  for (const chunk of split(text)) {
    for (const find of FINDERS) findings = merge(findings, find(chunk, offset, findings))
    offset += chunk.length
  }
  return findings
}

// Specific prefixes come before the generic `sk-` so the kind names the issuer.
const TOKENS = [
  { pattern: /\bsk-ant-[A-Za-z0-9_-]{20,400}/g, kind: "anthropic-key" },
  { pattern: /\bsk-or-[A-Za-z0-9_-]{20,400}/g, kind: "openrouter-key" },
  { pattern: /\bsk-[A-Za-z0-9_-]{20,400}/g, kind: "openai-key" },
  { pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,255}/g, kind: "github-token" },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{30,255}/g, kind: "github-token" },
  { pattern: /\bglpat-[A-Za-z0-9_-]{20,255}/g, kind: "gitlab-token" },
  { pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9])/g, kind: "aws-access-key" },
  { pattern: /\bAIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g, kind: "google-api-key" },
  { pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,255}/g, kind: "slack-token" },
  { pattern: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,255}/g, kind: "stripe-key" },
  { pattern: /\bnpm_[A-Za-z0-9]{36}(?![A-Za-z0-9])/g, kind: "npm-token" },
  { pattern: /\beyJ[A-Za-z0-9_-]{8,2048}\.eyJ[A-Za-z0-9_-]{8,4096}\.[A-Za-z0-9_-]{8,2048}/g, kind: "jwt" },
]

const URL_PATTERN = /(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/[^\s"'`<>]{1,4096}/g
const USERINFO = /^([A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/)([^/?#@\s]{1,512})@/
const QUERY_PARAM = /([?&;])([A-Za-z0-9_.[\]-]{1,64})=([^&#;\s]{1,4096})/g
const AUTHORIZATION = /\b(Bearer|Basic|bearer|basic|BEARER|BASIC)([ \t]{1,8})([A-Za-z0-9._~+/-]{6,4096}={0,3})/g
// A name starts where no identifier continues into it; `--flag` still starts one, `a-b` does not.
const NAME = /(?<![A-Za-z0-9_.$])(?<![A-Za-z0-9_.$]-)(["']?)([A-Za-z_][A-Za-z0-9_.-]{0,63})\1[ \t]{0,4}([:=])/g
const UNQUOTED_VALUE = /[^\s,;&"'`()[\]{}<>|]{0,4096}/y
const DELIMITER = /[\s,;&"'`()[\]{}<>|]/
const ENTROPY_TOKEN = /[A-Za-z0-9+/_-]{0,512}={0,2}/y
const QUOTED_VALUE: Record<string, RegExp> = {
  '"': /(?:[^"\\\r\n]|\\[^\r\n]){0,4096}(?=")/y,
  "'": /(?:[^'\\\r\n]|\\[^\r\n]){0,4096}(?=')/y,
  "`": /(?:[^`\\\r\n]|\\[^\r\n]){0,4096}(?=`)/y,
}
// The lookahead is atomic, so a quoted run is measured once instead of being retried at every shorter length.
const QUOTED_TOKEN = /(["'`])(?=([A-Za-z0-9+/_=-]{32,512}))\2\1/g
const PEM_BODY = /(?:[A-Za-z0-9+/=]|\\n|\r?\n)*/y
const PLACEHOLDER_VALUE = /^(?:\*+|x{3,}|\.{3}|…|•+|<[^>]*>|\[redacted[^\]]*\])$/i
const MEMBER_PATH = /^[A-Za-z_$][\w$]{0,63}(?:\.[A-Za-z_$][\w$]{0,63}){1,8}$/
const CONSTANT = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/
/** Every name `classify` accepts contains one of these, so most names are rejected without splitting them. */
const SECRET_HINT = /pass|pwd|secret|token|key|credential|auth|cookie|signature/i
const KEY_NAME =
  /(?:api|access|secret|signing|encryption|master|ssh|license|account|service|client|app|auth|session|shared|storage)key/
const LITERALS = new Set([
  "null",
  "nil",
  "none",
  "true",
  "false",
  "undefined",
  "yes",
  "no",
  "on",
  "off",
  "string",
  "str",
  "number",
  "int",
  "integer",
  "bool",
  "boolean",
  "any",
  "unknown",
  "object",
  "optional",
  "required",
  "empty",
  "await",
  "new",
  "this",
  "self",
])
/** A secret word followed by one of these names something about the secret, not the secret itself. */
const DESCRIPTORS = new Set([
  "file",
  "path",
  "dir",
  "directory",
  "url",
  "uri",
  "endpoint",
  "type",
  "name",
  "id",
  "ids",
  "env",
  "var",
  "header",
  "length",
  "len",
  "count",
  "limit",
  "size",
  "policy",
  "prompt",
  "field",
  "format",
  "provider",
  "helper",
  "mode",
  "source",
  "method",
  "label",
  "hint",
  "expiry",
  "expires",
  "expiration",
  "ttl",
  "timeout",
  "version",
  "enabled",
  "required",
  "usage",
  "budget",
  "estimate",
  "index",
  "prefix",
  "suffix",
  "pattern",
  "schema",
  "kind",
])

type Value = {
  readonly text: string
  readonly start: number
  readonly end: number
  readonly quoted: boolean
  /** A `name: value` pair with a space after the colon, which prose shares with YAML. */
  readonly spaced: boolean
  /** An unquoted value directly followed by `(`: a function call, not a literal. */
  readonly call: boolean
}

const redactTokens = (text: string) =>
  TOKENS.reduce((current, rule) => current.replace(rule.pattern, placeholder(rule.kind)), text)

/** The password in `scheme://user:password@host` and credential-named query parameters. */
const redactURLParts = (text: string) =>
  text.replace(URL_PATTERN, (url) =>
    url
      .replace(USERINFO, (match, scheme: string, userinfo: string) => {
        if (userinfo.includes(MARK)) return match
        const colon = userinfo.indexOf(":")
        if (colon < 0) return userinfo.length >= 20 ? `${scheme}${placeholder("url-credentials")}@` : match
        if (colon === userinfo.length - 1) return match
        return `${scheme}${userinfo.slice(0, colon)}:${placeholder("password")}@`
      })
      .replace(QUERY_PARAM, (match, lead: string, name: string, value: string) => {
        const lower = name.toLowerCase()
        const kind = lower === "key" ? "api-key" : lower === "sig" ? "signature" : classify(name)
        if (!kind || value.startsWith(MARK)) return match
        return `${lead}${name}=${placeholder(kind)}`
      }),
  )

/**
 * `Bearer` and `Basic` credentials. A plain word after the scheme is prose such as "Bearer tokens", and `Basic` takes
 * only base64, so "Basic set-up" stays.
 */
const redactAuthorization = (text: string) =>
  text.replace(AUTHORIZATION, (match, scheme: string, space: string, token: string) => {
    if (scheme.toLowerCase() === "basic" && !/^[A-Za-z0-9+/]{8,4096}={0,2}$/.test(token)) return match
    const credential =
      /[^A-Za-z]/.test(token) || (/[a-z]/.test(token) && /[A-Z]/.test(token) && !/^[A-Z][a-z]+$/.test(token))
    return credential ? `${scheme}${space}${placeholder("authorization")}` : match
  })

/** `NAME=value`, `"name": "value"` and `name: value`: only the value goes, and only when it looks like one. */
const redactAssignments = (text: string) => {
  const parts: string[] = []
  let cursor = 0
  NAME.lastIndex = 0
  for (let match = NAME.exec(text); match; match = NAME.exec(text)) {
    const kind = classify(match[2])
    const value = readValue(text, NAME.lastIndex, match[3], kind !== undefined)
    if (!value || !value.text || value.text.startsWith(MARK)) continue
    // A secret-named value is read once as a whole, so names nested in it are not each read again to its end.
    if (kind) NAME.lastIndex = value.end
    const redacted = kind ? (plausible(value) ? kind : undefined) : highEntropy(value.text) ? "secret" : undefined
    if (!redacted) continue
    parts.push(text.slice(cursor, value.start), placeholder(redacted))
    cursor = value.end
    NAME.lastIndex = value.end
  }
  if (cursor === 0) return text
  parts.push(text.slice(cursor))
  return parts.join("")
}

/** A long random-looking string in quotes is a secret whatever it is called. */
const redactQuoted = (text: string) =>
  text.replace(QUOTED_TOKEN, (match, quote: string, token: string) =>
    highEntropy(token) ? `${quote}${placeholder("secret")}${quote}` : match,
  )

const PASSES = [redactTokens, redactURLParts, redactAuthorization, redactAssignments, redactQuoted]

/**
 * The value after a separator. Under a name that is not secret only an unquoted token can matter, and only up to the
 * length `highEntropy` accepts; quoted ones are left to `redactQuoted`.
 */
function readValue(text: string, position: number, separator: string, secret: boolean): Value | undefined {
  const next = text[position]
  // `==`, `::`, `=>` and `=~` are operators, not assignments; Go's `:=` is one.
  if (next === separator || next === ">" || next === "~") return undefined
  const from = separator === ":" && next === "=" ? position + 1 : position
  const blank = /^[ \t]{0,4}/.exec(text.slice(from, from + 4))?.[0].length ?? 0
  const index = from + blank
  const spaced = separator === ":" && blank > 0
  const quote = text[index]
  const quoted = quote === undefined ? undefined : QUOTED_VALUE[quote]
  if (!secret) {
    if (quoted) return undefined
    ENTROPY_TOKEN.lastIndex = index
    const token = ENTROPY_TOKEN.exec(text)?.[0] ?? ""
    const end = index + token.length
    // A token that runs on is part of something longer, such as a path or a data URL.
    if (end < text.length && !DELIMITER.test(text[end])) return undefined
    return { text: token, start: index, end, quoted: false, spaced, call: false }
  }
  if (quoted) {
    quoted.lastIndex = index + 1
    const body = quoted.exec(text)?.[0]
    if (body === undefined) return undefined
    return { text: body, start: index + 1, end: index + 1 + body.length, quoted: true, spaced, call: false }
  }
  UNQUOTED_VALUE.lastIndex = index
  const body = UNQUOTED_VALUE.exec(text)?.[0] ?? ""
  const end = index + body.length
  return { text: body, start: index, end, quoted: false, spaced, call: text[end] === "(" }
}

/** The kind of secret an identifier names, split into words across camelCase, `_`, `-` and `.`. */
function classify(name: string) {
  if (!SECRET_HINT.test(name)) return undefined
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  const last = words.at(-1)
  if (last === undefined || DESCRIPTORS.has(last)) return undefined
  if (words.some((word) => /passw(?:or)?d|passphrase/.test(word) || word === "pass" || word === "pwd"))
    return "password"
  const joined = words.join("")
  if (joined.includes("privatekey")) return "private-key"
  if (words.some((word) => word.endsWith("token"))) return "token"
  if (words.some((word) => word.includes("secret"))) return "secret"
  if (KEY_NAME.test(joined)) return "api-key"
  if (words.some((word) => word.startsWith("credential"))) return "credential"
  if (last === "auth" || last === "authorization") return "authorization"
  if (last === "cookie" || last === "signature") return last
  return undefined
}

/** Whether a value under a secret name is a literal secret rather than a reference, a type or a placeholder. */
function plausible(value: Pick<Value, "text" | "quoted" | "spaced" | "call">) {
  const text = value.text
  if (!text || PLACEHOLDER_VALUE.test(text)) return false
  if (value.quoted) return !/^(?:\$|\{\{|<|%)/.test(text) && !text.includes("${")
  if (value.call || /^[$%{[(<*&@]/.test(text) || LITERALS.has(text.toLowerCase())) return false
  if (MEMBER_PATH.test(text) || CONSTANT.test(text) || /^\d{1,5}$/.test(text)) return false
  return !value.spaced || (text.length >= 6 && /[^A-Za-z]/.test(text))
}

/**
 * A 32 to 512 character token of mixed-case letters and digits that changes character class often, as random keys
 * do. Hex digests, UUIDs and git SHAs have one letter case; identifiers and paths change class only between words;
 * subresource integrity hashes name their algorithm. A `/` only passes beside base64's `+` or `=`, which paths lack.
 */
function highEntropy(text: string) {
  if (text.length < 32 || text.length > 512 || !/^[A-Za-z0-9+/_=-]+$/.test(text)) return false
  if (/^sha(?:1|256|384|512)-/.test(text)) return false
  if (text.includes("/") && !/[+=]/.test(text)) return false
  const classes = Array.from(text, (char) =>
    /[a-z]/.test(char) ? 0 : /[A-Z]/.test(char) ? 1 : /\d/.test(char) ? 2 : 3,
  )
  if (!classes.includes(0) || !classes.includes(1) || classes.filter((item) => item === 2).length < 2) return false
  const changes = classes.filter((item, index) => index > 0 && item !== classes[index - 1]).length
  return changes / text.length >= 0.3
}

/** PEM private key blocks, found with plain searches over the whole text since a block spans lines. */
function redactPrivateKeys(text: string) {
  const blocks = privateKeyBlocks(text)
  if (blocks.length === 0) return text
  return (
    blocks
      .map((block, index) => text.slice(index === 0 ? 0 : blocks[index - 1].end, block.start) + placeholder("private-key"))
      .join("") + text.slice(blocks[blocks.length - 1].end)
  )
}

/** Where each PEM private key block starts and ends, in order. */
function privateKeyBlocks(text: string) {
  const blocks: { start: number; end: number }[] = []
  // The next `-----END ` at or after the block being read; -1 once none is left, so no search repeats.
  let end = 0
  let search = text.indexOf(PEM_BEGIN)
  while (search >= 0) {
    const labelEnd = text.slice(search + PEM_BEGIN.length, search + PEM_BEGIN.length + 96).indexOf("-----")
    const body = search + PEM_BEGIN.length + labelEnd + 5
    if (labelEnd < 0 || !text.slice(search, body).includes("PRIVATE KEY")) {
      search = text.indexOf(PEM_BEGIN, search + PEM_BEGIN.length)
      continue
    }
    if (end >= 0 && end < body) end = text.indexOf(PEM_END, body)
    const stop = end >= 0 && end - body <= PEM_MAX ? closeOf(text, end) : unterminated(text, body)
    blocks.push({ start: search, end: stop })
    search = text.indexOf(PEM_BEGIN, stop)
  }
  return blocks
}

/** Just past the dashes that close a `-----END … PRIVATE KEY-----` line. */
function closeOf(text: string, end: number) {
  const close = text.slice(end + PEM_END.length, end + PEM_END.length + 96).indexOf("-----")
  return close < 0 ? end + PEM_END.length : end + PEM_END.length + close + 5
}

/** A block cut off before its end line, such as a truncated quote, runs over its base64 lines, escaped or not. */
function unterminated(text: string, body: number) {
  PEM_BODY.lastIndex = body
  return body + (PEM_BODY.exec(text)?.[0].length ?? 0)
}

function split(text: string) {
  const chunks: string[] = []
  let start = 0
  while (text.length - start > CHUNK) {
    const end = boundary(text, start + CHUNK)
    chunks.push(text.slice(start, end))
    start = end
  }
  chunks.push(text.slice(start))
  return chunks
}

/** Just after the last line break, else the last space, in the window before `limit`; `limit` when there is none. */
function boundary(text: string, limit: number) {
  const window = text.slice(limit - SPLIT_WINDOW, limit)
  const line = window.lastIndexOf("\n")
  const space = line >= 0 ? line : Math.max(window.lastIndexOf(" "), window.lastIndexOf("\t"))
  return space >= 0 ? limit - SPLIT_WINDOW + space + 1 : limit
}

function deep(value: unknown, depth: number): unknown {
  if (typeof value === "string") return redact(value)
  if (depth > 32 || typeof value !== "object" || value === null) return value
  if (Array.isArray(value)) return value.map((item) => deep(item, depth + 1))
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      typeof item === "string" ? redactField(key, item) : deep(item, depth + 1),
    ]),
  )
}

function redactField(key: string, text: string) {
  const kind = classify(key)
  return kind && plausible({ text, quoted: true, spaced: false, call: false }) ? placeholder(kind) : redact(text)
}

/** One `redact` pass that reports instead of replacing: new findings in `chunk`, which starts at `offset`. */
type Finder = (chunk: string, offset: number, taken: readonly Finding[]) => Finding[]

const finding = (start: number, value: string, kind: string, confidence: Confidence): Finding => ({
  start,
  end: start + value.length,
  kind,
  value,
  confidence,
})

/** Whether `[start, end)` meets a finding already made; `taken` is sorted and disjoint, so a binary search does. */
function overlaps(taken: readonly Finding[], start: number, end: number) {
  let low = 0
  let high = taken.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (taken[middle].end <= start) low = middle + 1
    else high = middle
  }
  return low < taken.length && taken[low].start < end
}

const merge = (taken: readonly Finding[], found: readonly Finding[]) =>
  found.length === 0 ? [...taken] : [...taken, ...found].sort((left, right) => left.start - right.start)

const free = (taken: readonly Finding[]) => (item: Finding) => !overlaps(taken, item.start, item.end)

function tokenFinder(rule: (typeof TOKENS)[number]): Finder {
  return (chunk, offset, taken) =>
    Array.from(chunk.matchAll(rule.pattern), (match) =>
      finding(offset + match.index, match[0], rule.kind, "high"),
    ).filter(free(taken))
}

/** The password in `scheme://user:password@host` and credential-named query parameters, as `redactURLParts`. */
function urlFinder(chunk: string, offset: number, taken: readonly Finding[]) {
  return Array.from(chunk.matchAll(URL_PATTERN)).flatMap((match) => {
    const url = match[0]
    const at = offset + match.index
    const userinfo = USERINFO.exec(url)
    const credentials = userinfo ? userinfoFinding(userinfo[1], userinfo[2], at) : []
    const parameters = Array.from(url.matchAll(QUERY_PARAM)).flatMap((parameter) => {
      const lower = parameter[2].toLowerCase()
      const kind = lower === "key" ? "api-key" : lower === "sig" ? "signature" : classify(parameter[2])
      if (!kind || parameter[3].startsWith(MARK)) return []
      const start = at + parameter.index + parameter[1].length + parameter[2].length + 1
      return [finding(start, parameter[3], kind, "high")]
    })
    return [...credentials, ...parameters].filter(free(taken))
  })
}

function userinfoFinding(scheme: string, userinfo: string, at: number) {
  const colon = userinfo.indexOf(":")
  if (colon < 0)
    return userinfo.length >= 20 ? [finding(at + scheme.length, userinfo, "url-credentials", "high")] : []
  if (colon === userinfo.length - 1) return []
  return [finding(at + scheme.length + colon + 1, userinfo.slice(colon + 1), "password", "high")]
}

function authorizationFinder(chunk: string, offset: number, taken: readonly Finding[]) {
  return Array.from(chunk.matchAll(AUTHORIZATION)).flatMap((match) => {
    const token = match[3]
    if (match[1].toLowerCase() === "basic" && !/^[A-Za-z0-9+/]{8,4096}={0,2}$/.test(token)) return []
    const credential =
      /[^A-Za-z]/.test(token) || (/[a-z]/.test(token) && /[A-Z]/.test(token) && !/^[A-Z][a-z]+$/.test(token))
    if (!credential) return []
    return [finding(offset + match.index + match[1].length + match[2].length, token, "authorization", "low")]
  }).filter(free(taken))
}

/** `redactAssignments` reporting: a secret name makes a high finding, the entropy heuristic under any name a low one. */
function assignmentFinder(chunk: string, offset: number, taken: readonly Finding[]) {
  const findings: Finding[] = []
  NAME.lastIndex = 0
  for (let match = NAME.exec(chunk); match; match = NAME.exec(chunk)) {
    const kind = classify(match[2])
    const value = readValue(chunk, NAME.lastIndex, match[3], kind !== undefined)
    if (!value || !value.text || value.text.startsWith(MARK)) continue
    if (kind) NAME.lastIndex = value.end
    const found = kind ? (plausible(value) ? kind : undefined) : highEntropy(value.text) ? "secret" : undefined
    if (!found) continue
    NAME.lastIndex = value.end
    const item = finding(offset + value.start, value.text, found, kind ? "high" : "low")
    if (free(taken)(item)) findings.push(item)
  }
  return findings
}

function quotedFinder(chunk: string, offset: number, taken: readonly Finding[]) {
  return Array.from(chunk.matchAll(QUOTED_TOKEN)).flatMap((match) =>
    highEntropy(match[2]) ? [finding(offset + match.index + 1, match[2], "secret", "low")] : [],
  ).filter(free(taken))
}

// The order of PASSES, each token family on its own so an earlier, more specific family wins. Secret-named
// assignments come before `Authorization` credentials, so a quoted `"Authorization": "Bearer …"` stays one high
// finding instead of a low one inside it.
const FINDERS: readonly Finder[] = [
  ...TOKENS.map(tokenFinder),
  urlFinder,
  assignmentFinder,
  authorizationFinder,
  quotedFinder,
]
