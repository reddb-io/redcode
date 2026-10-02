import { fixture, testFile } from "./coding-cases"
import type { CodingCase } from "./coding-cases"

// A separate corpus: none of these families participated in the 2026-10-02 model collection.
// Freeze the split before model tuning; hidden checks and reference code never enter the agent workspace.
export const challengeCases: readonly CodingCase[] = [
  fixture({
    id: "singleflight-settlement",
    family: "singleflight-settlement",
    split: "calibration",
    category: "concurrent-request-lifecycle",
    requirements:
      "createSingleFlight returns run(key, task). Overlapping calls for the same key return the very same Promise and invoke only the first task. Different keys run independently. After success or failure that key must be reusable with a new task. Synchronous task throws become rejected promises with the original error; run must not throw synchronously. Keys are literal strings, including empty strings and __proto__. No timers or external dependencies are needed.",
    source: `export function createSingleFlight<T>() {
  const pending = new Map<string, Promise<T>>()
  return {
    run(key: string, task: () => Promise<T>): Promise<T> {
      if (pending.has(key)) return pending.get(key)!
      const result = task()
      pending.set(key, result)
      return result
    },
  }
}
`,
    test: testFile(
      "createSingleFlight",
      "returns a task result",
      `  expect(await createSingleFlight<number>().run("one", async () => 7)).toBe(7)`,
    ),
    checks: `  await check("same-key-same-promise", async () => {
    const flight = target.createSingleFlight()
    let release
    let calls = 0
    const first = flight.run("", () => { calls++; return new Promise((resolve) => { release = resolve }) })
    const second = flight.run("", async () => { calls++; return 99 })
    await Promise.resolve()
    release(7)
    return first === second && await first === 7 && await second === 7 && calls === 1
  })
  await check("success-evicts-key", async () => {
    const flight = target.createSingleFlight()
    return await flight.run("a", async () => 1) === 1 && await flight.run("a", async () => 2) === 2
  })
  await check("rejection-evicts-key", async () => {
    const flight = target.createSingleFlight()
    const error = new Error("original")
    try { await flight.run("a", async () => { throw error }) } catch (actual) {
      return actual === error && await flight.run("a", async () => 8) === 8
    }
    return false
  })
  await check("sync-throw-is-rejection", async () => {
    const flight = target.createSingleFlight()
    const error = new Error("synchronous")
    let result
    try { result = flight.run("a", () => { throw error }) } catch { return false }
    if (!(result instanceof Promise)) return false
    try { await result } catch (actual) { return actual === error && await flight.run("a", async () => 3) === 3 }
    return false
  })
  await check("different-keys-independent", async () => {
    const flight = target.createSingleFlight()
    let release
    const first = flight.run("__proto__", () => new Promise((resolve) => { release = resolve }))
    const second = flight.run("constructor", async () => 4)
    const value = await second
    release(9)
    return value === 4 && await first === 9 && await flight.run("__proto__", async () => 5) === 5
  })
`,
    reference: `export function createSingleFlight<T>() {
  const pending = new Map<string, Promise<T>>()
  return {
    run(key: string, task: () => Promise<T>): Promise<T> {
      const previous = pending.get(key)
      if (previous) return previous
      const result = Promise.resolve().then(task)
      pending.set(key, result)
      const settle = () => { if (pending.get(key) === result) pending.delete(key) }
      result.then(settle, settle)
      return result
    },
  }
}
`,
  }),
  fixture({
    id: "composite-page-cursor",
    family: "composite-page-cursor",
    split: "calibration",
    category: "pagination-consistency",
    requirements:
      "page sorts unique records by time ascending, then id using JavaScript string comparison (not locale collation). A cursor is the exclusive (time,id) lower bound even if that record is absent. Return at most limit records; next is the last returned record's (time,id) only when further eligible records remain, otherwise null. limit is a positive safe integer, otherwise throw RangeError. Do not mutate or reorder input records or the cursor. Record times are safe integers.",
    source: `export type Row = { time: number; id: string; value: string }
export type Cursor = { time: number; id: string }
export function page(rows: readonly Row[], cursor: Cursor | null, limit: number): { items: Row[]; next: Cursor | null } {
  const eligible = [...rows].sort((a, b) => a.time - b.time).filter((row) => !cursor || row.time > cursor.time)
  const items = eligible.slice(0, limit)
  const last = items.at(-1)
  return { items, next: last ? { time: last.time, id: last.id } : null }
}
`,
    test: testFile(
      "page",
      "returns a first page",
      `  expect(page([{ time: 1, id: "a", value: "A" }, { time: 2, id: "b", value: "B" }], null, 1)).toEqual({ items: [{ time: 1, id: "a", value: "A" }], next: { time: 1, id: "a" } })`,
    ),
    checks: `  const rows = Object.freeze([
    Object.freeze({ time: 2, id: "a", value: "last" }),
    Object.freeze({ time: 1, id: "z", value: "z" }),
    Object.freeze({ time: 1, id: "A", value: "A" }),
    Object.freeze({ time: 1, id: "a", value: "a" }),
  ])
  await check("ties-use-string-order", () => equal(target.page(rows, null, 2).items.map((row) => row.id), ["A", "a"]))
  await check("exclusive-tuple-keeps-time-ties", () => equal(target.page(rows, Object.freeze({ time: 1, id: "A" }), 2).items.map((row) => row.id), ["a", "z"]))
  await check("absent-cursor-is-lower-bound", () => equal(target.page(rows, { time: 1, id: "b" }, 5).items.map((row) => row.value), ["z", "last"]))
  await check("terminal-page-has-no-cursor", () => target.page(rows, { time: 1, id: "z" }, 1).next === null && equal(target.page([], null, 1), { items: [], next: null }))
  await check("full-pagination-no-skips-or-duplicates", () => {
    let cursor = null
    const ids = []
    for (let step = 0; step < 5; step++) {
      const result = target.page(rows, cursor, 1)
      ids.push(...result.items.map((row) => row.value))
      cursor = result.next
      if (!cursor) break
    }
    return equal(ids, ["A", "a", "z", "last"])
  })
  await check("invalid-limit-rejected", () => [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1].every((limit) => {
    try { target.page(rows, null, limit) } catch (error) { return error instanceof RangeError }
    return false
  }))
  await check("input-order-preserved", () => { target.page(rows, null, 10); return equal(rows.map((row) => row.value), ["last", "z", "A", "a"]) })
`,
    reference: `export type Row = { time: number; id: string; value: string }
export type Cursor = { time: number; id: string }
export function page(rows: readonly Row[], cursor: Cursor | null, limit: number): { items: Row[]; next: Cursor | null } {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Invalid limit")
  const eligible = rows.filter((row) => !cursor || row.time > cursor.time || (row.time === cursor.time && row.id > cursor.id))
    .sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const items = eligible.slice(0, limit)
  const last = items.at(-1)
  return { items, next: eligible.length > limit && last ? { time: last.time, id: last.id } : null }
}
`,
  }),
  fixture({
    id: "three-way-document-merge",
    family: "three-way-document-merge",
    split: "calibration",
    category: "conflict-resolution",
    requirements:
      "merge compares base, local and remote dictionaries per own key. Values are strings or null; absence means deletion and differs from null. If local matches base, take remote; if remote matches base, take local; if local matches remote, take that value. Otherwise list the key as a conflict and keep local (including its deletion). Return a new dictionary and conflicts sorted by JavaScript string order. Preserve all inputs. Treat __proto__ and constructor as ordinary own keys.",
    source: `export type Document = Readonly<Record<string, string | null>>
export function merge(base: Document, local: Document, remote: Document): { value: Record<string, string | null>; conflicts: string[] } {
  return { value: { ...local, ...remote }, conflicts: [] }
}
`,
    test: testFile(
      "merge",
      "combines independent added fields",
      `  expect(merge({}, { a: "local" }, { b: "remote" })).toEqual({ value: { a: "local", b: "remote" }, conflicts: [] })`,
    ),
    checks: `  await check("local-edit-remote-unchanged", () => equal(target.merge({ a: "base" }, { a: "local" }, { a: "base" }), { value: { a: "local" }, conflicts: [] }))
  await check("remote-deletion-local-unchanged", () => equal(target.merge({ a: "base" }, { a: "base" }, {}), { value: {}, conflicts: [] }))
  await check("local-deletion-remote-unchanged", () => equal(target.merge({ a: "base" }, {}, { a: "base" }), { value: {}, conflicts: [] }))
  await check("conflicts-preserve-local-and-sort", () => equal(target.merge({ z: "base", A: "base" }, { z: "left" }, { z: "right", A: "changed" }), { value: { z: "left" }, conflicts: ["A", "z"] }))
  await check("null-is-not-absence", () => equal(target.merge({ a: null }, {}, { a: "remote" }), { value: {}, conflicts: ["a"] }) && equal(target.merge({}, { a: null }, { a: null }), { value: { a: null }, conflicts: [] }))
  await check("same-edits-no-conflict", () => equal(target.merge({ a: "base" }, { a: "same" }, { a: "same" }), { value: { a: "same" }, conflicts: [] }))
  await check("special-own-keys-and-immutable-input", () => {
    const base = Object.freeze(JSON.parse('{"__proto__":"base","constructor":"base"}'))
    const local = Object.freeze(JSON.parse('{"__proto__":"local","constructor":"base"}'))
    const remote = Object.freeze(JSON.parse('{"__proto__":"base","constructor":null}'))
    const result = target.merge(base, local, remote)
    return Object.hasOwn(result.value, "__proto__") && result.value.__proto__ === "local" && result.value.constructor === null && equal(result.conflicts, []) && base.__proto__ === "base"
  })
`,
    reference: `export type Document = Readonly<Record<string, string | null>>
export function merge(base: Document, local: Document, remote: Document): { value: Record<string, string | null>; conflicts: string[] } {
  const value: Record<string, string | null> = {}
  const conflicts: string[] = []
  const keys = [...new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])].sort()
  for (const key of keys) {
    const same = (left: Document, right: Document) => Object.hasOwn(left, key) === Object.hasOwn(right, key) && left[key] === right[key]
    const chosen = same(local, base) ? remote : same(remote, base) || same(local, remote) ? local : undefined
    if (!chosen) conflicts.push(key)
    const source = chosen ?? local
    if (Object.hasOwn(source, key)) Object.defineProperty(value, key, { value: source[key], enumerable: true, writable: true, configurable: true })
  }
  return { value, conflicts }
}
`,
  }),
  fixture({
    id: "bounded-fifo-admission",
    family: "bounded-fifo-admission",
    split: "held-out",
    category: "bounded-execution",
    requirements:
      "createQueue(concurrency) returns submit(task). concurrency must be a positive safe integer, otherwise throw RangeError immediately. Start queued tasks in submission order while never exceeding concurrency active tasks. Each submit returns its own Promise carrying the exact task result or error. Both asynchronous rejection and synchronous throws release their slot and allow the next task to start. Failures must not prevent later tasks. Task invocation may be deferred to a microtask. No timers or dependencies are needed.",
    source: `export function createQueue(concurrency: number) {
  let active = 0
  const waiting: Array<() => void> = []
  const start = () => {
    if (active < concurrency && waiting.length) waiting.shift()!()
  }
  return {
    submit<T>(task: () => Promise<T>): Promise<T> {
      return new Promise((resolve, reject) => {
        waiting.push(() => {
          active++
          task().then((value) => { active--; resolve(value); start() }, reject)
        })
        start()
      })
    },
  }
}
`,
    test: testFile(
      "createQueue",
      "runs an ordinary task",
      `  expect(await createQueue(1).submit(async () => 7)).toBe(7)`,
    ),
    checks: `  const drain = async () => { for (let count = 0; count < 20; count++) await Promise.resolve() }
  await check("invalid-concurrency-rejected", () => [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1].every((limit) => {
    try { target.createQueue(limit) } catch (error) { return error instanceof RangeError }
    return false
  }))
  await check("rejection-releases-slot", async () => {
    const queue = target.createQueue(1)
    const error = new Error("original")
    let caught
    let next
    queue.submit(async () => { throw error }).catch((actual) => { caught = actual })
    queue.submit(async () => 9).then((value) => { next = value })
    await drain()
    return caught === error && next === 9
  })
  await check("sync-throw-releases-slot", async () => {
    const queue = target.createQueue(1)
    const error = new Error("sync")
    let caught
    let next
    queue.submit(() => { throw error }).catch((actual) => { caught = actual })
    queue.submit(async () => 8).then((value) => { next = value })
    await drain()
    return caught === error && next === 8
  })
  await check("concurrency-and-fifo", async () => {
    const queue = target.createQueue(2)
    const starts = []
    const releases = []
    const promises = [0, 1, 2, 3].map((id) => queue.submit(() => { starts.push(id); return new Promise((resolve) => { releases[id] = resolve }) }))
    await drain()
    if (!equal(starts, [0, 1])) { releases.forEach((release) => release(0)); return false }
    releases[1]("second")
    await drain()
    if (!equal(starts, [0, 1, 2])) { releases.forEach((release) => release(0)); return false }
    releases[0]("first")
    await drain()
    if (!equal(starts, [0, 1, 2, 3])) { releases.forEach((release) => release(0)); return false }
    releases[2]("third")
    releases[3]("fourth")
    return equal(await Promise.all(promises), ["first", "second", "third", "fourth"])
  })
`,
    reference: `export function createQueue(concurrency: number) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new RangeError("Invalid concurrency")
  let active = 0
  const waiting: Array<() => void> = []
  const start = () => {
    while (active < concurrency && waiting.length) waiting.shift()!()
  }
  return {
    submit<T>(task: () => Promise<T>): Promise<T> {
      return new Promise((resolve, reject) => {
        waiting.push(() => {
          active++
          const settle = () => { active--; start() }
          Promise.resolve().then(task).then(
            (value) => { settle(); resolve(value) },
            (error) => { settle(); reject(error) },
          )
        })
        start()
      })
    },
  }
}
`,
  }),
  fixture({
    id: "quoted-csv-records",
    family: "quoted-csv-records",
    split: "held-out",
    category: "parser-state",
    requirements:
      "parseCSV returns records of string fields. Commas separate fields; LF or CRLF separate records outside quotes. A quoted field begins with a double quote at field start and ends with a double quote; doubled quotes inside it represent one literal quote. Preserve commas, CR and LF inside quoted fields exactly. Outside quotes, lone CR is field content. Preserve empty fields and blank records; a final record delimiter adds no extra record. Empty input returns []. Reject unterminated quotes, quotes within unquoted fields, and characters after closing quotes other than comma or a record delimiter, using SyntaxError. Do not trim whitespace.",
    source: `export function parseCSV(text: string): string[][] {
  if (!text) return []
  const records = text.split(/\\r?\\n/)
  if (text.endsWith("\\n")) records.pop()
  return records.map((record) => record.split(","))
}
`,
    test: testFile(
      "parseCSV",
      "reads unquoted fields",
      `  expect(parseCSV("a,b\\r\\nc,d\\n")).toEqual([["a", "b"], ["c", "d"]])`,
    ),
    checks: `  await check("quoted-delimiter", () => equal(target.parseCSV('"alpha,beta",tail'), [["alpha,beta", "tail"]]))
  await check("escaped-quote", () => equal(target.parseCSV('"say ""yes""",x'), [['say "yes"', "x"]]))
  await check("multiline-quoted-field", () => equal(target.parseCSV('"first\\r\\nsecond",end\\n'), [["first\\r\\nsecond", "end"]]))
  await check("empty-fields-and-blank-records", () => equal(target.parseCSV(',\\n\\n"",last,'), [["", ""], [""], ["", "last", ""]]) && equal(target.parseCSV(""), []))
  await check("rejects-invalid-quote-states", () => ['"unterminated', 'a"b,c', '"closed"tail,x', ' "quoted",x'].every((text) => {
    try { target.parseCSV(text) } catch (error) { return error instanceof SyntaxError }
    return false
  }))
  await check("lone-cr-and-untrimmed-values", () => equal(target.parseCSV(' a\\rb ," c "'), [[" a\\rb ", " c "]]))
`,
    reference: `export function parseCSV(text: string): string[][] {
  if (!text) return []
  const records: string[][] = []
  let record: string[] = []
  let field = ""
  let state: "start" | "plain" | "quoted" | "closed" = "start"
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (state === "quoted") {
      if (char !== '"') { field += char; continue }
      if (text[index + 1] === '"') { field += '"'; index++; continue }
      state = "closed"
      continue
    }
    if (char === ",") { record.push(field); field = ""; state = "start"; continue }
    if (char === "\\n" || (char === "\\r" && text[index + 1] === "\\n")) {
      if (char === "\\r") index++
      record.push(field)
      records.push(record)
      record = []
      field = ""
      state = "start"
      continue
    }
    if (state === "closed") throw new SyntaxError("Content after closing quote")
    if (char === '"') {
      if (state !== "start") throw new SyntaxError("Quote inside unquoted field")
      state = "quoted"
      continue
    }
    field += char
    state = "plain"
  }
  if (state === "quoted") throw new SyntaxError("Unterminated quote")
  if (!text.endsWith("\\n") || state !== "start" || record.length || field) { record.push(field); records.push(record) }
  return records
}
`,
  }),
  fixture({
    id: "specific-route-resolution",
    family: "specific-route-resolution",
    split: "held-out",
    category: "dispatch-precedence",
    requirements:
      "resolveRoute takes patterns and an encoded absolute path (no query or fragment). Split on slash before decoding segments, so %2F remains data inside one segment. Decode each path segment once; malformed escapes throw URIError. Patterns contain literal decoded segments, :name for one nonempty segment, or final *name for zero or more segments joined by slash. Among matching patterns choose lexicographically by segment specificity: literal (2), parameter (1), wildcard (0); a fully consumed exact pattern beats a trailing wildcard matching zero segments. Equal specificity uses original pattern order. Return {pattern,params} or null, keep inputs unchanged, and treat parameter names such as __proto__ as own keys. Root is / and trailing slashes are significant.",
    source: `export function resolveRoute(patterns: readonly string[], pathname: string): { pattern: string; params: Record<string, string> } | null {
  const segments = decodeURIComponent(pathname).slice(1).split("/")
  for (const pattern of patterns) {
    const parts = pattern.slice(1).split("/")
    if (parts.length !== segments.length) continue
    const params: Record<string, string> = {}
    if (!parts.every((part, index) => { if (part.startsWith(":")) { params[part.slice(1)] = segments[index]; return true } return part === segments[index] })) continue
    return { pattern, params }
  }
  return null
}
`,
    test: testFile(
      "resolveRoute",
      "matches a simple parameter",
      `  expect(resolveRoute(["/users/:id"], "/users/alice")).toEqual({ pattern: "/users/:id", params: { id: "alice" } })`,
    ),
    checks: `  await check("literal-beats-earlier-parameter", () => target.resolveRoute(["/users/:id", "/users/new"], "/users/new")?.pattern === "/users/new")
  await check("earliest-position-specificity", () => target.resolveRoute(["/:section/new", "/users/:id"], "/users/new")?.pattern === "/users/:id")
  await check("encoded-slash-is-segment-data", () => equal(target.resolveRoute(["/files/:name"], "/files/a%2Fb"), { pattern: "/files/:name", params: { name: "a/b" } }))
  await check("wildcard-and-exact-zero-tail", () => equal(target.resolveRoute(["/files/*rest"], "/files/a/b"), { pattern: "/files/*rest", params: { rest: "a/b" } }) && target.resolveRoute(["/files/*rest", "/files"], "/files")?.pattern === "/files" && equal(target.resolveRoute(["/files/*rest"], "/files"), { pattern: "/files/*rest", params: { rest: "" } }))
  await check("root-empty-param-and-trailing-slash", () => equal(target.resolveRoute(["/"], "/"), { pattern: "/", params: {} }) && target.resolveRoute(["/users/:id"], "/users/") === null && target.resolveRoute(["/users"], "/users/") === null)
  await check("decode-once-and-malformed-path", () => {
    if (target.resolveRoute(["/files/:name"], "/files/%252F")?.params.name !== "%2F") return false
    try { target.resolveRoute([], "/bad%XX") } catch (error) { return error instanceof URIError }
    return false
  })
  await check("own-param-keys-and-order-tie", () => {
    const patterns = Object.freeze(["/x/:__proto__", "/x/:other"])
    const result = target.resolveRoute(patterns, "/x/value")
    return result?.pattern === patterns[0] && Object.hasOwn(result.params, "__proto__") && result.params.__proto__ === "value" && equal(patterns, ["/x/:__proto__", "/x/:other"])
  })
`,
    reference: `export function resolveRoute(patterns: readonly string[], pathname: string): { pattern: string; params: Record<string, string> } | null {
  const segments = pathname === "/" ? [] : pathname.slice(1).split("/").map((part) => decodeURIComponent(part))
  const matches = patterns.flatMap((pattern, order) => {
    const parts = pattern === "/" ? [] : pattern.slice(1).split("/")
    const params: Record<string, string> = {}
    const rank: number[] = []
    let consumed = 0
    for (const part of parts) {
      if (part.startsWith("*")) {
        Object.defineProperty(params, part.slice(1), { value: segments.slice(consumed).join("/"), enumerable: true })
        rank.push(0)
        consumed = segments.length
        break
      }
      const value = segments[consumed]
      if (value === undefined) return []
      if (part.startsWith(":")) {
        if (!value) return []
        Object.defineProperty(params, part.slice(1), { value, enumerable: true })
        rank.push(1)
      } else {
        if (part !== value) return []
        rank.push(2)
      }
      consumed++
    }
    if (consumed !== segments.length) return []
    rank.push(3)
    return [{ pattern, params, rank, order }]
  })
  matches.sort((left, right) => {
    for (let index = 0; index < Math.max(left.rank.length, right.rank.length); index++) {
      const difference = (right.rank[index] ?? -1) - (left.rank[index] ?? -1)
      if (difference) return difference
    }
    return left.order - right.order
  })
  const result = matches[0]
  return result ? { pattern: result.pattern, params: result.params } : null
}
`,
  }),
]
