// The boot trace: one line per phase from process start to the first rendered screen.
//
// Every phase is always recorded in memory, whatever the flags say: `redcode debug startup`
// prints the same list, so it and `--verbose` cannot disagree. Writing is what `--verbose`
// (or REDCODE_VERBOSE=1) turns on: each mark goes to stderr until something takes the terminal
// over, and to a per-run file for as long as the process lives, so a trace that ran under the
// TUI can still be read after it exits.
//
// The TUI runs its server in a worker thread, which has its own copy of this module. The two
// halves share the process start and the file through the worker's own environment
// (`workerEnv()`), never through `process.env`: a `redcode run` the bash tool spawns, an MCP
// server or an LSP must not inherit the parent's clock, its file or its flag, so what this module
// reads from the environment it reads once, at import, and removes.
import fs from "fs"
import path from "path"
import { isMainThread } from "node:worker_threads"
import { Global } from "../global"

export interface Mark {
  readonly phase: string
  /** Milliseconds since the process started. */
  readonly since: number
  /** Milliseconds since the previous mark in this thread. */
  readonly delta: number
  readonly facts: Readonly<Record<string, string | number | boolean>>
}

export type Facts = Record<string, string | number | boolean | undefined | null>

const ENV = {
  verbose: "REDCODE_VERBOSE",
  start: "REDCODE_BOOT_START",
  file: "REDCODE_VERBOSE_BOOT_FILE",
  noStderr: "REDCODE_VERBOSE_NO_STDERR",
} as const

// `apiKey`, `access_token`, `Authorization`, `passphrase` — but not `estimatedTokens`, which counts.
const SECRET_KEY = /key$|token$|secret|password|passwd|passphrase|auth|bearer|cookie|credential/i
const SECRET_VALUE = /^(bearer\s|basic\s|sk-|ghp_|github_pat_|xox[abp]-|ya29\.|AKIA|AIza|gsk_|xai-)/i
const URL_USERINFO = /\/\/[^/@\s]+@/g

/**
 * Values that could be a credential never reach a log: any fact whose key names one, any value
 * shaped like one, and the userinfo of any URL. The rest is printed as it is, so a phase can
 * name a path or a provider.
 */
export function redact(facts: Facts): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(facts)) {
    if (value === undefined || value === null) continue
    if (SECRET_KEY.test(key)) {
      out[key] = "[redacted]"
      continue
    }
    if (typeof value === "string") {
      if (SECRET_VALUE.test(value)) {
        out[key] = "[redacted]"
        continue
      }
      out[key] = value.replace(URL_USERINFO, "//[redacted]@")
      continue
    }
    out[key] = value
  }
  return out
}

function stamp(date = new Date()) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z")
}

function truthy(value: string | undefined) {
  const lower = value?.toLowerCase()
  return lower === "1" || lower === "true"
}

interface Shared {
  verbose: boolean
  start: number
  file: string | undefined
  mirror: boolean
}

/** Read the sharing variables once and remove them, so nothing this process spawns sees them. */
function consume(): Shared {
  const take = (key: string) => {
    const value = process.env[key]
    delete process.env[key]
    return value
  }
  const verbose = truthy(take(ENV.verbose))
  const inherited = Number(take(ENV.start))
  const file = take(ENV.file)
  const mirror = !truthy(take(ENV.noStderr))
  return {
    verbose,
    start: Number.isFinite(inherited) && inherited > 0 ? inherited : Math.round(performance.timeOrigin),
    file,
    mirror,
  }
}

let shared = consume()
const marks: Mark[] = []
let written = 0
let previous: number | undefined
let stderrOpen = true
let stopped = false
let completed: number | undefined
let fileReady = false
let fileFailed = false

/** True when `--verbose` (or REDCODE_VERBOSE=1) asked for the trace to be written. */
export function enabled() {
  return shared.verbose
}

/** `--verbose` was given: from here every recorded mark is written. */
export function enable(value = true) {
  shared.verbose = value
}

/**
 * Whether the activity trace may also go to stderr. Commands with a screen of their own — the
 * TUI, `--mini` — turn this off, and their worker inherits the choice through `workerEnv()`.
 */
export function mirror() {
  return shared.mirror
}

export function setMirror(value: boolean) {
  shared.mirror = value
}

/** The instant the process started, shared with worker threads through `workerEnv()`. */
export function start() {
  return shared.start
}

/** The file the trace is written to; decided once per process family and shared with workers. */
export function filePath() {
  if (!shared.file) shared.file = path.join(Global.Path.log, `boot-${stamp()}-${process.pid}.log`)
  if (!fileReady && !fileFailed) {
    try {
      fs.mkdirSync(path.dirname(shared.file), { recursive: true })
      fileReady = true
    } catch {
      fileFailed = true
    }
  }
  return shared.file
}

/**
 * What a worker thread needs to continue this trace on the same clock and in the same file.
 * Goes into the worker's own `env`, not `process.env`; empty when tracing is off.
 */
export function workerEnv(): Record<string, string> {
  if (!shared.verbose) return {}
  return {
    [ENV.verbose]: "1",
    [ENV.start]: String(shared.start),
    [ENV.file]: filePath(),
    ...(shared.mirror ? {} : { [ENV.noStderr]: "1" }),
  }
}

function thread() {
  return isMainThread ? "" : "[server]"
}

export function formatMark(mark: Mark) {
  const facts = Object.entries(mark.facts)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(" ")
  const since = `${String(Math.round(mark.since)).padStart(5)}ms`
  const delta = `+${Math.round(mark.delta)}ms`
  return `boot${thread()} ${since} ${delta.padStart(8)} ${mark.phase}${facts ? " " + facts : ""}`
}

function formatValue(value: string | number | boolean) {
  const text = String(value)
  return /^[^\s="\\]+$/.test(text) ? text : JSON.stringify(text)
}

function append(line: string) {
  const target = filePath()
  if (fileFailed) return
  try {
    fs.appendFileSync(target, line + "\n")
  } catch {
    fileFailed = true
  }
}

function write(line: string) {
  if (stderrOpen) process.stderr.write(line + "\n")
  append(line)
}

/**
 * Record a boot phase. Always cheap: with tracing off it pushes one small object and returns.
 * With tracing on the line goes to stderr while the terminal is still ours, and to the file.
 * Once boot is over the list stops growing — a server that runs for days keeps writing marks
 * to its file, not to memory — but every mark is still written.
 */
export function mark(phase: string, facts: Facts = {}) {
  const now = Date.now()
  const since = now - shared.start
  const entry: Mark = {
    phase,
    since,
    delta: previous === undefined ? since : now - previous,
    facts: redact(facts),
  }
  previous = now
  if (stopped) {
    if (shared.verbose) write(formatMark(entry))
    return entry
  }
  marks.push(entry)
  if (shared.verbose) flush()
  return entry
}

/**
 * Write every recorded mark not yet written. The flag is parsed after the first marks are
 * recorded, so the first write under `--verbose` catches up on `process.start` rather than
 * losing it.
 */
export function flush() {
  if (!shared.verbose) return
  for (; written < marks.length; written++) write(formatMark(marks[written]!))
}

/** Every phase recorded up to the end of boot, in order. */
export function phases(): readonly Mark[] {
  return marks
}

/**
 * The terminal is about to belong to a full-screen UI: from here nothing more goes to stderr.
 * Phases keep going to the file. Says where to look while stderr is still ours.
 */
export function quiet() {
  if (!stderrOpen) return
  stderrOpen = false
  if (!shared.verbose) return
  const now = Date.now()
  const line = `boot${thread()} ${String(now - shared.start).padStart(5)}ms          screen takeover; the trace continues in ${filePath()}`
  process.stderr.write(line + "\n")
  append(line)
}

/** Whether phases still print to stderr. */
export function loud() {
  return stderrOpen
}

export function summary() {
  const last = marks.at(-1)
  const total = Math.round(completed ?? last?.since ?? Date.now() - shared.start)
  return shared.verbose ? `boot complete in ${total} ms; log at ${filePath()}` : `boot complete in ${total} ms`
}

/**
 * Boot is over: the screen rendered, or a command reached the point where its work begins.
 * Prints the summary once. Later marks are still written (to the file, and to stderr where it
 * is still ours) but no longer retained, and the summary is never repeated.
 */
export function stop(phase = "boot.complete", facts: Facts = {}) {
  if (stopped) return summary()
  completed = mark(phase, facts).since
  stopped = true
  const line = summary()
  if (shared.verbose) write(line)
  return line
}

export function isStopped() {
  return stopped
}

/** Test seam: forget every mark, reopen stderr and read the environment again. */
export function reset() {
  shared = consume()
  marks.length = 0
  written = 0
  previous = undefined
  stderrOpen = true
  stopped = false
  completed = undefined
  fileReady = false
  fileFailed = false
}

export * as BootTrace from "./boot-trace"
