export type CodingCase = {
  readonly id: string
  readonly family: string
  readonly split: "calibration" | "held-out"
  readonly category: string
  readonly prompt: string
  readonly files: Readonly<Record<string, string>>
  readonly editable: readonly string[]
  readonly checkIDs: readonly string[]
  readonly oracle: string
  readonly reference: Readonly<Record<string, string>>
}

const testFile = (imports: string, name: string, body: string) =>
  `import { expect, test } from "bun:test"\nimport { ${imports} } from "./src.ts"\n\ntest(${JSON.stringify(name)}, async () => {\n${body}\n})\n`

function fixture(input: {
  id: string
  family: string
  split: CodingCase["split"]
  category: string
  requirements: string
  source: string
  test: string
  checks: string
  reference: string
}): CodingCase {
  return {
    id: input.id,
    family: input.family,
    split: input.split,
    category: input.category,
    prompt: `${input.requirements}\n\nFix src.ts while preserving its exported API. Only src.ts may change; keep package.json and src.test.ts unchanged and do not add files. Run bun run test and report its actual result.`,
    files: {
      "package.json": `${JSON.stringify({ private: true, type: "module", scripts: { test: "bun test" } }, null, 2)}\n`,
      "src.ts": input.source,
      "src.test.ts": input.test,
    },
    editable: ["src.ts"],
    checkIDs: ["module-load", ...Array.from(input.checks.matchAll(/await check\("([^"]+)"/g), (match) => match[1])],
    oracle: `import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { isDeepStrictEqual } from "node:util"

const checks = []
const equal = isDeepStrictEqual
const check = async (id, verify) => {
  try {
    checks.push({ id, pass: (await verify()) === true })
  } catch {
    checks.push({ id, pass: false })
  }
}
try {
  if (!process.env.REDCODE_EVAL_FIXTURE) throw new Error("Missing fixture directory")
  const target = await import(pathToFileURL(join(process.env.REDCODE_EVAL_FIXTURE, "src.ts")).href)
  checks.push({ id: "module-load", pass: true })
${input.checks}
} catch {
  checks.push({ id: "module-load", pass: false })
}
console.log(JSON.stringify({ checks }))
`,
    reference: { "src.ts": input.reference },
  }
}

// Families and the split are fixed before tuning. Reference edits are evaluator-test inputs,
// never visible workspace files or model instructions.
export const codingCases: readonly CodingCase[] = [
  fixture({
    id: "half-open-overlap",
    family: "interval-overlap",
    split: "calibration",
    category: "boundary-behavior",
    requirements:
      "The scheduling helper overlaps compares half-open intervals [start, end). Touching endpoints must not overlap. Empty or reversed intervals never overlap. Nonempty intersecting intervals overlap, including negative coordinates. Inputs must remain unchanged.",
    source: `export type Interval = { start: number; end: number }
export function overlaps(left: Interval, right: Interval) {
  return left.start <= right.end && right.start <= left.end
}
`,
    test: testFile(
      "overlaps",
      "ordinary overlapping schedules",
      `  expect(overlaps({ start: 1, end: 4 }, { start: 2, end: 5 })).toBe(true)
  expect(overlaps({ start: 1, end: 2 }, { start: 5, end: 6 })).toBe(false)`,
    ),
    checks: `  await check("touching-is-disjoint", () => target.overlaps({ start: 1, end: 3 }, { start: 3, end: 6 }) === false)
  await check("empty-is-disjoint", () => target.overlaps({ start: 2, end: 2 }, { start: 1, end: 4 }) === false)
  await check("reversed-is-disjoint", () => target.overlaps({ start: 4, end: 2 }, { start: 1, end: 8 }) === false)
  await check("negative-overlap", () => target.overlaps({ start: -5, end: -1 }, { start: -3, end: 2 }) === true)
  await check("nested-and-symmetric", () => {
    const outer = Object.freeze({ start: -8, end: 9 })
    const inner = Object.freeze({ start: 0, end: 1 })
    return target.overlaps(outer, inner) === true && target.overlaps(inner, outer) === true
  })
`,
    reference: `export type Interval = { start: number; end: number }
export function overlaps(left: Interval, right: Interval) {
  return left.start < left.end && right.start < right.end && left.start < right.end && right.start < left.end
}
`,
  }),
  fixture({
    id: "partial-preferences",
    family: "partial-preferences",
    split: "calibration",
    category: "state-updates",
    requirements:
      "applyPreferences returns new preferences without mutating either argument. An omitted or undefined patch field leaves that field unchanged. A null notificationEmail clears it, and newsletter=false disables the newsletter. All supplied non-undefined fields otherwise replace their current value.",
    source: `export type Preferences = { theme: "light" | "dark"; newsletter: boolean; notificationEmail: string | null }
export function applyPreferences(current: Preferences, patch: Partial<Preferences>): Preferences {
  return {
    theme: patch.theme ?? current.theme,
    newsletter: patch.newsletter || current.newsletter,
    notificationEmail: patch.notificationEmail ?? current.notificationEmail,
  }
}
`,
    test: testFile(
      "applyPreferences",
      "theme can be changed",
      `  const current = { theme: "light" as const, newsletter: true, notificationEmail: "owner@example.test" }
  expect(applyPreferences(current, { theme: "dark" }).theme).toBe("dark")
  expect(current.theme).toBe("light")`,
    ),
    checks: `  const current = Object.freeze({ theme: "dark", newsletter: true, notificationEmail: "owner@example.test" })
  await check("clear-null-email", () => target.applyPreferences(current, { notificationEmail: null }).notificationEmail === null)
  await check("disable-newsletter", () => target.applyPreferences(current, { newsletter: false }).newsletter === false)
  await check("undefined-preserves-values", () => equal(target.applyPreferences(current, { theme: undefined, newsletter: undefined, notificationEmail: undefined }), current))
  await check("empty-patch-copy", () => {
    const result = target.applyPreferences(current, Object.freeze({}))
    return result !== current && equal(result, current)
  })
  await check("combined-update", () => equal(target.applyPreferences(current, { theme: "light", newsletter: false, notificationEmail: "new@example.test" }), { theme: "light", newsletter: false, notificationEmail: "new@example.test" }))
`,
    reference: `export type Preferences = { theme: "light" | "dark"; newsletter: boolean; notificationEmail: string | null }
export function applyPreferences(current: Preferences, patch: Partial<Preferences>): Preferences {
  return {
    theme: patch.theme ?? current.theme,
    newsletter: patch.newsletter ?? current.newsletter,
    notificationEmail: patch.notificationEmail === undefined ? current.notificationEmail : patch.notificationEmail,
  }
}
`,
  }),
  fixture({
    id: "async-map-order",
    family: "async-result-order",
    split: "calibration",
    category: "asynchrony",
    requirements:
      "mapOrdered may run work concurrently, but its returned results must preserve input order regardless of completion order. Pass each item and its original index to work, leave the input untouched, handle empty input, and reject with the original error if any work rejects.",
    source: `export async function mapOrdered<T, U>(items: readonly T[], work: (item: T, index: number) => Promise<U>): Promise<U[]> {
  const result: U[] = []
  await Promise.all(items.map(async (item, index) => {
    result.push(await work(item, index))
  }))
  return result
}
`,
    test: testFile(
      "mapOrdered",
      "maps immediate values",
      `  expect(await mapOrdered([1, 2], async (value) => value * 2)).toEqual([2, 4])`,
    ),
    checks: `  await check("reverse-completion-order", async () => {
    const result = await target.mapOrdered(Object.freeze([2, 5, 8]), async (value, index) => {
      for (let pause = 0; pause < (2 - index) * 3; pause++) await Promise.resolve()
      return { value: value * 3, index }
    })
    return equal(result, [{ value: 6, index: 0 }, { value: 15, index: 1 }, { value: 24, index: 2 }])
  })
  await check("empty-input", async () => equal(await target.mapOrdered([], async () => { throw new Error("must not run") }), []))
  await check("original-rejection", async () => {
    const error = new Error("work failed")
    try { await target.mapOrdered([1], async () => { throw error }) } catch (actual) { return actual === error }
    return false
  })
  await check("input-is-unchanged", async () => {
    const input = Object.freeze([7, 4])
    await target.mapOrdered(input, async (value, index) => value + index)
    return equal(input, [7, 4])
  })
`,
    reference: `export async function mapOrdered<T, U>(items: readonly T[], work: (item: T, index: number) => Promise<U>): Promise<U[]> {
  return Promise.all(items.map((item, index) => work(item, index)))
}
`,
  }),
  fixture({
    id: "unicode-codepoint-limit",
    family: "unicode-codepoints",
    split: "calibration",
    category: "text-processing",
    requirements:
      "takeCodePoints returns at most limit Unicode code points from the start of text, preserving supplementary characters without splitting surrogate pairs. Count code points rather than grapheme clusters. A zero limit returns empty text; negative, fractional or unsafe-integer limits throw RangeError.",
    source: `export function takeCodePoints(text: string, limit: number) {
  return text.slice(0, limit)
}
`,
    test: testFile(
      "takeCodePoints",
      "limits basic text",
      `  expect(takeCodePoints("abcdef", 3)).toBe("abc")
  expect(takeCodePoints("abc", 0)).toBe("")`,
    ),
    checks: `  await check("supplementary-start", () => target.takeCodePoints("𝄞alpha", 1) === "𝄞")
  await check("supplementary-middle", () => target.takeCodePoints("a𝄞b", 2) === "a𝄞")
  await check("combining-is-two-points", () => target.takeCodePoints("e\\u0301x", 1) === "e" && target.takeCodePoints("e\\u0301x", 2) === "e\\u0301")
  await check("long-limit-preserves-text", () => target.takeCodePoints("𝄞ab", 20) === "𝄞ab")
  await check("rejects-invalid-limits", () => [-1, 1.5, Number.MAX_SAFE_INTEGER + 1].every((limit) => {
    try { target.takeCodePoints("abc", limit) } catch (error) { return error instanceof RangeError }
    return false
  }))
`,
    reference: `export function takeCodePoints(text: string, limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError("Invalid limit")
  return Array.from(text).slice(0, limit).join("")
}
`,
  }),
  fixture({
    id: "retry-attempt-limit",
    family: "retry-attempt-budget",
    split: "calibration",
    category: "execution-control",
    requirements:
      "retry calls task with one-based attempt numbers. maxAttempts includes the first call and is a positive safe integer. Stop immediately on success. After exhausting that many failures, reject with the exact last error. Invalid maxAttempts throws RangeError before invoking task.",
    source: `export async function retry<T>(task: (attempt: number) => Promise<T>, maxAttempts: number): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts + 1; attempt++) {
    try { return await task(attempt) } catch (error) {
      if (attempt === maxAttempts + 1) throw error
    }
  }
  throw new Error("No attempts")
}
`,
    test: testFile(
      "retry",
      "returns an immediate success",
      `  expect(await retry(async () => "done", 3)).toBe("done")`,
    ),
    checks: `  await check("one-attempt-means-one-call", async () => {
    const calls = []
    const error = new Error("last")
    try { await target.retry(async (attempt) => { calls.push(attempt); throw error }, 1) } catch (actual) { return actual === error && equal(calls, [1]) }
    return false
  })
  await check("last-error-and-bound", async () => {
    const calls = []
    const errors = [new Error("first"), new Error("second")]
    try { await target.retry(async (attempt) => { calls.push(attempt); throw errors[attempt - 1] }, 2) } catch (actual) { return actual === errors[1] && equal(calls, [1, 2]) }
    return false
  })
  await check("success-stops-retries", async () => {
    const calls = []
    const result = await target.retry(async (attempt) => { calls.push(attempt); if (attempt === 1) throw new Error("first"); return "ready" }, 4)
    return result === "ready" && equal(calls, [1, 2])
  })
  await check("invalid-budget-no-call", async () => {
    for (const limit of [0, -2, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      let called = false
      try { await target.retry(async () => { called = true }, limit) } catch (error) { if (error instanceof RangeError && !called) continue }
      return false
    }
    return true
  })
`,
    reference: `export async function retry<T>(task: (attempt: number) => Promise<T>, maxAttempts: number): Promise<T> {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new RangeError("Invalid attempt budget")
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { return await task(attempt) } catch (error) {
      if (attempt === maxAttempts) throw error
    }
  }
  throw new Error("No attempts")
}
`,
  }),
  fixture({
    id: "canonical-header-values",
    family: "header-canonicalization",
    split: "calibration",
    category: "protocol-data",
    requirements:
      "normalizeHeaders trims surrounding whitespace from names and values and lowercases names. Repeated names, regardless of casing, combine values with comma-space in input order. Empty values are meaningful. Return a dictionary with each normalized name as its own property, including names such as constructor and __proto__. Do not mutate input entries.",
    source: `export function normalizeHeaders(entries: readonly (readonly [string, string])[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of entries) result[name.toLowerCase()] = value
  return result
}
`,
    test: testFile(
      "normalizeHeaders",
      "normalizes a single ordinary header",
      `  expect(normalizeHeaders([["Accept", "text/plain"]]).accept).toBe("text/plain")`,
    ),
    checks: `  await check("combines-case-insensitive-values", () => target.normalizeHeaders([["Accept", "json"], ["ACCEPT", "text"]]).accept === "json, text")
  await check("trims-name-and-value", () => target.normalizeHeaders([[" X-Tag ", " one "]])["x-tag"] === "one")
  await check("retains-empty-first-value", () => target.normalizeHeaders([["x-tag", ""], ["X-Tag", "next"]])["x-tag"] === ", next")
  await check("dictionary-special-names", () => {
    const result = target.normalizeHeaders([["__proto__", "literal"], ["constructor", "safe"]])
    return Object.hasOwn(result, "__proto__") && result.__proto__ === "literal" && Object.hasOwn(result, "constructor") && result.constructor === "safe"
  })
  await check("immutable-input", () => {
    const entries = Object.freeze([Object.freeze(["X-Test", "first"]), Object.freeze(["x-test", "second"])])
    return target.normalizeHeaders(entries)["x-test"] === "first, second" && equal(entries, [["X-Test", "first"], ["x-test", "second"]])
  })
`,
    reference: `export function normalizeHeaders(entries: readonly (readonly [string, string])[]): Record<string, string> {
  const result: Record<string, string> = Object.create(null)
  for (const [name, value] of entries) {
    const key = name.trim().toLowerCase()
    result[key] = Object.hasOwn(result, key) ? result[key] + ", " + value.trim() : value.trim()
  }
  return result
}
`,
  }),
  fixture({
    id: "dependency-order",
    family: "dependency-ordering",
    split: "held-out",
    category: "graph-ordering",
    requirements:
      "orderJobs returns every job ID once, after all of that job's dependencies. When multiple jobs are ready, choose the one appearing earliest in the original input. IDs are unique and all dependency IDs exist. Throw Error for a dependency cycle. Do not mutate jobs or their dependency arrays.",
    source: `export type Job = { id: string; dependsOn: readonly string[] }
export function orderJobs(jobs: readonly Job[]): string[] {
  return [...jobs].sort((left, right) => left.dependsOn.length - right.dependsOn.length).map((job) => job.id)
}
`,
    test: testFile(
      "orderJobs",
      "orders a simple dependency",
      `  expect(orderJobs([{ id: "build", dependsOn: ["fetch"] }, { id: "fetch", dependsOn: [] }])).toEqual(["fetch", "build"])`,
    ),
    checks: `  await check("reversed-chain", () => equal(target.orderJobs([{ id: "ship", dependsOn: ["test"] }, { id: "test", dependsOn: ["build"] }, { id: "build", dependsOn: ["fetch"] }, { id: "fetch", dependsOn: [] }]), ["fetch", "build", "test", "ship"]))
  await check("ready-tie-uses-original-position", () => equal(target.orderJobs([{ id: "a", dependsOn: ["b"] }, { id: "b", dependsOn: [] }, { id: "c", dependsOn: [] }]), ["b", "a", "c"]))
  await check("cycle-is-rejected", () => {
    try { target.orderJobs([{ id: "a", dependsOn: ["b"] }, { id: "b", dependsOn: ["a"] }]) } catch (error) { return error instanceof Error }
    return false
  })
  await check("self-cycle-is-rejected", () => {
    try { target.orderJobs([{ id: "a", dependsOn: ["a"] }]) } catch (error) { return error instanceof Error }
    return false
  })
  await check("empty-and-frozen-input", () => {
    const jobs = Object.freeze([Object.freeze({ id: "b", dependsOn: Object.freeze(["a"]) }), Object.freeze({ id: "a", dependsOn: Object.freeze([]) })])
    return equal(target.orderJobs([]), []) && equal(target.orderJobs(jobs), ["a", "b"])
  })
`,
    reference: `export type Job = { id: string; dependsOn: readonly string[] }
export function orderJobs(jobs: readonly Job[]): string[] {
  const remaining = [...jobs]
  const result: string[] = []
  const completed = new Set<string>()
  while (remaining.length) {
    const index = remaining.findIndex((job) => job.dependsOn.every((id) => completed.has(id)))
    if (index < 0) throw new Error("Dependency cycle")
    const job = remaining.splice(index, 1)[0]
    result.push(job.id)
    completed.add(job.id)
  }
  return result
}
`,
  }),
  fixture({
    id: "subscription-disposal",
    family: "subscription-disposal",
    split: "held-out",
    category: "resource-lifecycle",
    requirements:
      "subscribe registers the given callback in the supplied Set and returns its unsubscribe function. Unsubscribing removes only that callback; other callbacks must remain registered. Repeated unsubscribe calls are harmless and must not remove callbacks registered later. The caller supplies distinct callbacks for separate subscriptions.",
    source: `export function subscribe<T>(listeners: Set<(value: T) => void>, callback: (value: T) => void) {
  listeners.add(callback)
  return () => listeners.clear()
}
`,
    test: testFile(
      "subscribe",
      "removes a single subscription",
      `  const listeners = new Set<(value: number) => void>()
  const unsubscribe = subscribe(listeners, () => {})
  expect(listeners.size).toBe(1)
  unsubscribe()
  expect(listeners.size).toBe(0)`,
    ),
    checks: `  await check("retains-other-subscription", () => {
    const listeners = new Set()
    const first = () => {}
    const second = () => {}
    const remove = target.subscribe(listeners, first)
    target.subscribe(listeners, second)
    remove()
    return !listeners.has(first) && listeners.has(second) && listeners.size === 1
  })
  await check("idempotent-disposal-retains-later-listener", () => {
    const listeners = new Set()
    const remove = target.subscribe(listeners, () => {})
    remove()
    const later = () => {}
    target.subscribe(listeners, later)
    remove()
    return listeners.has(later) && listeners.size === 1
  })
  await check("remaining-handler-still-receives-events", () => {
    const listeners = new Set()
    const delivered = []
    const remove = target.subscribe(listeners, (value) => delivered.push("first:" + value))
    target.subscribe(listeners, (value) => delivered.push("second:" + value))
    remove()
    listeners.forEach((listener) => listener("event"))
    return equal(delivered, ["second:event"])
  })
`,
    reference: `export function subscribe<T>(listeners: Set<(value: T) => void>, callback: (value: T) => void) {
  listeners.add(callback)
  return () => { listeners.delete(callback) }
}
`,
  }),
  fixture({
    id: "chunked-line-framing",
    family: "stream-framing",
    split: "held-out",
    category: "stream-processing",
    requirements:
      "splitLines treats chunks as consecutive fragments of one text stream. Both LF and CRLF terminate lines, including delimiters split between chunks. Preserve empty lines inside the stream and a final unterminated line. A trailing line terminator adds no extra final empty line. Empty input returns an empty array; lone CR characters remain content.",
    source: `export function splitLines(chunks: readonly string[]): string[] {
  return chunks.flatMap((chunk) => chunk.split("\\n")).filter(Boolean)
}
`,
    test: testFile(
      "splitLines",
      "splits complete ordinary lines",
      `  expect(splitLines(["one\\ntwo\\n"])).toEqual(["one", "two"])`,
    ),
    checks: `  await check("joins-line-fragments", () => equal(target.splitLines(["al", "pha\\nb", "eta"]), ["alpha", "beta"]))
  await check("split-crlf-delimiter", () => equal(target.splitLines(["alpha\\r", "\\nbeta\\r", "\\n"]), ["alpha", "beta"]))
  await check("preserves-interior-empty-lines", () => equal(target.splitLines(["a\\n", "\\nb\\n"]), ["a", "", "b"]))
  await check("empty-and-one-empty-line", () => equal(target.splitLines([]), []) && equal(target.splitLines(["", ""]), []) && equal(target.splitLines(["\\n"]), [""]))
  await check("lone-cr-is-content", () => equal(target.splitLines(["a\\rb\\nc"]), ["a\\rb", "c"]))
  await check("all-chunk-boundaries", () => {
    const text = "alpha\\r\\n\\nbeta\\nend"
    for (let index = 0; index <= text.length; index++) {
      if (!equal(target.splitLines([text.slice(0, index), text.slice(index)]), ["alpha", "", "beta", "end"])) return false
    }
    return true
  })
`,
    reference: `export function splitLines(chunks: readonly string[]): string[] {
  const text = chunks.join("")
  if (!text) return []
  const result = text.split(/\\r?\\n/)
  return text.endsWith("\\n") ? result.slice(0, -1) : result
}
`,
  }),
  fixture({
    id: "atomic-stock-adjustments",
    family: "atomic-stock-updates",
    split: "held-out",
    category: "transaction-behavior",
    requirements:
      "applyAdjustments applies changes in order to known stock keys. Each resulting quantity must be a nonnegative safe integer. Delta must be a safe integer, and unknown keys are errors. On any error, throw Error and leave every stock entry exactly unchanged. On success, commit all adjustments to the original stock object. Do not mutate the adjustments.",
    source: `export type Adjustment = { sku: string; delta: number }
export function applyAdjustments(stock: Record<string, number>, changes: readonly Adjustment[]): void {
  for (const change of changes) {
    if (!Object.hasOwn(stock, change.sku)) throw new Error("Unknown stock key")
    stock[change.sku] += change.delta
    if (stock[change.sku] < 0) throw new Error("Insufficient stock")
  }
}
`,
    test: testFile(
      "applyAdjustments",
      "commits an ordinary adjustment",
      `  const stock = { widget: 5 }
  applyAdjustments(stock, [{ sku: "widget", delta: -2 }])
  expect(stock).toEqual({ widget: 3 })`,
    ),
    checks: `  await check("rollback-after-later-negative", () => {
    const stock = { a: 4, b: 2 }
    try { target.applyAdjustments(stock, [{ sku: "a", delta: 1 }, { sku: "b", delta: -3 }]) } catch (error) { return error instanceof Error && equal(stock, { a: 4, b: 2 }) }
    return false
  })
  await check("rollback-after-unknown-key", () => {
    const stock = { a: 4 }
    try { target.applyAdjustments(stock, [{ sku: "a", delta: -1 }, { sku: "absent", delta: 2 }]) } catch (error) { return error instanceof Error && equal(stock, { a: 4 }) }
    return false
  })
  await check("rejects-fractional-delta", () => {
    const stock = { a: 4 }
    try { target.applyAdjustments(stock, [{ sku: "a", delta: 0.5 }]) } catch (error) { return error instanceof Error && equal(stock, { a: 4 }) }
    return false
  })
  await check("rejects-overflow-atomically", () => {
    const stock = { a: Number.MAX_SAFE_INTEGER }
    try { target.applyAdjustments(stock, [{ sku: "a", delta: 1 }]) } catch (error) { return error instanceof Error && stock.a === Number.MAX_SAFE_INTEGER }
    return false
  })
  await check("success-order-and-input-preservation", () => {
    const stock = { a: 2, b: 0 }
    const changes = Object.freeze([Object.freeze({ sku: "a", delta: -2 }), Object.freeze({ sku: "a", delta: 3 }), Object.freeze({ sku: "b", delta: 4 })])
    target.applyAdjustments(stock, changes)
    return equal(stock, { a: 3, b: 4 }) && equal(changes, [{ sku: "a", delta: -2 }, { sku: "a", delta: 3 }, { sku: "b", delta: 4 }])
  })
`,
    reference: `export type Adjustment = { sku: string; delta: number }
export function applyAdjustments(stock: Record<string, number>, changes: readonly Adjustment[]): void {
  const next = { ...stock }
  for (const change of changes) {
    if (!Object.hasOwn(next, change.sku)) throw new Error("Unknown stock key")
    if (!Number.isSafeInteger(change.delta)) throw new Error("Invalid delta")
    const quantity = next[change.sku] + change.delta
    if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error("Invalid stock quantity")
    next[change.sku] = quantity
  }
  Object.assign(stock, next)
}
`,
  }),
  fixture({
    id: "literal-secret-redaction",
    family: "literal-redaction",
    split: "held-out",
    category: "data-handling",
    requirements:
      "redact replaces occurrences of nonempty secret strings with [REDACTED]. Treat secrets literally, including regex metacharacters. At each position choose the longest matching secret and consume it once. Replacement text must not be scanned again. Ignore empty secrets and leave unrelated text unchanged.",
    source: `export function redact(text: string, secrets: readonly string[]): string {
  return secrets.filter(Boolean).reduce((result, secret) => result.replace(new RegExp(secret, "g"), "[REDACTED]"), text)
}
`,
    test: testFile(
      "redact",
      "replaces a simple secret",
      `  expect(redact("before token after", ["token"])).toBe("before [REDACTED] after")`,
    ),
    checks: `  await check("literal-dot", () => target.redact("a.b axb a.b", ["a.b"]) === "[REDACTED] axb [REDACTED]")
  await check("literal-invalid-regex", () => target.redact("x [secret] y", ["[secret]"]) === "x [REDACTED] y" && target.redact("x [ y", ["["]) === "x [REDACTED] y")
  await check("longest-overlap", () => target.redact("token-long token", ["token", "token-long"]) === "[REDACTED] [REDACTED]")
  await check("replacement-not-rescanned", () => target.redact("secret", ["secret", "REDACTED"]) === "[REDACTED]")
  await check("empty-secrets-and-unrelated-text", () => target.redact("ordinary text", ["", "absent"]) === "ordinary text")
  await check("literal-dollar-and-backslash", () => target.redact("$key path\\\\value", ["$key", "path\\\\value"]) === "[REDACTED] [REDACTED]")
`,
    reference: `export function redact(text: string, secrets: readonly string[]): string {
  const ordered = [...new Set(secrets.filter(Boolean))].sort((left, right) => right.length - left.length)
  const result: string[] = []
  for (let index = 0; index < text.length;) {
    const match = ordered.find((secret) => text.startsWith(secret, index))
    result.push(match ? "[REDACTED]" : text[index])
    index += match ? match.length : 1
  }
  return result.join("")
}
`,
  }),
  fixture({
    id: "query-filter-encoding",
    family: "query-encoding",
    split: "held-out",
    category: "url-construction",
    requirements:
      "searchURL takes an absolute base URL and filter values. Preserve unrelated query parameters and the fragment. Replace existing values only for keys present in filters. A string sets one value, including an empty string; an array sets multiple values in input order, and an empty array removes that key. Properly encode names and values so punctuation and Unicode remain literal parameter data. Do not mutate filters.",
    source: `export function searchURL(base: string, filters: Readonly<Record<string, string | readonly string[]>>): string {
  const query = Object.entries(filters).flatMap(([key, values]) => (Array.isArray(values) ? values : [values]).map((value) => key + "=" + value)).join("&")
  return base + "?" + query
}
`,
    test: testFile(
      "searchURL",
      "sets an ordinary parameter",
      `  expect(new URL(searchURL("https://example.test/search", { q: "books" })).searchParams.get("q")).toBe("books")`,
    ),
    checks: `  await check("preserves-unrelated-query-and-fragment", () => {
    const result = new URL(target.searchURL("https://example.test/search?keep=one&q=old#section", { q: "new" }))
    return result.searchParams.get("keep") === "one" && equal(result.searchParams.getAll("q"), ["new"]) && result.hash === "#section"
  })
  await check("literal-punctuation-and-unicode", () => {
    const result = new URL(target.searchURL("https://example.test/search", { "tag&name": "café & tea=good#today" }))
    return result.searchParams.get("tag&name") === "café & tea=good#today" && [...result.searchParams.keys()].length === 1 && result.hash === ""
  })
  await check("ordered-repeated-values", () => {
    const result = new URL(target.searchURL("https://example.test/search?tag=old&keep=yes", { tag: ["two", "one"] }))
    return equal(result.searchParams.getAll("tag"), ["two", "one"]) && result.searchParams.get("keep") === "yes"
  })
  await check("empty-string-and-empty-array", () => {
    const result = new URL(target.searchURL("https://example.test/search?remove=yes", { remove: [], empty: "" }))
    return !result.searchParams.has("remove") && result.searchParams.has("empty") && result.searchParams.get("empty") === ""
  })
  await check("immutable-filters", () => {
    const values = Object.freeze(["first", "last"])
    const filters = Object.freeze({ tag: values })
    return equal(new URL(target.searchURL("https://example.test/search", filters)).searchParams.getAll("tag"), ["first", "last"]) && equal(values, ["first", "last"])
  })
`,
    reference: `export function searchURL(base: string, filters: Readonly<Record<string, string | readonly string[]>>): string {
  const result = new URL(base)
  for (const [key, values] of Object.entries(filters)) {
    result.searchParams.delete(key)
    for (const value of typeof values === "string" ? [values] : values) result.searchParams.append(key, value)
  }
  return result.toString()
}
`,
  }),
]
