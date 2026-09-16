// The boot trace: one line per phase from process start to the first rendered screen.
//
// Every phase is always recorded in memory, whatever the flags say: `redcode debug startup`
// prints the same list, so it and `--verbose` cannot disagree. Writing is what `--verbose`
// (REDCODE_VERBOSE=1) turns on: each mark goes to stderr until something takes the terminal
// over, and to a per-run file for as long as the process lives, so a trace that ran under the
// TUI can still be read after it exits.
//
// The TUI runs its server in a worker thread, which has its own copy of this module. The two
// halves share the process start (REDCODE_BOOT_START) and the file (REDCODE_VERBOSE_BOOT_FILE)
// through the environment, so their lines land in one file on one clock.
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

// `apiKey`, `access_token`, `Authorization` — but not `estimatedTokens` or `maxTokens`, which count.
const SECRET_KEY = /key$|token$|secret|password|passwd|authorization|cookie|credential/i
const SECRET_VALUE = /^(bearer\s|basic\s|sk-|ghp_|xox[abp]-|ya29\.)/i

/**
 * Values that could be a credential never reach a log: any fact whose key names one, and any
 * value shaped like one. The rest is printed as it is, so a phase can name a path or a provider.
 */
export function redact(facts: Facts): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(facts)) {
    if (value === undefined || value === null) continue
    if (SECRET_KEY.test(key)) {
      out[key] = "[redacted]"
      continue
    }
    if (typeof value === "string" && SECRET_VALUE.test(value)) {
      out[key] = "[redacted]"
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

const marks: Mark[] = []
let previous: number | undefined
let stderrOpen = true
let stopped = false
let completed: number | undefined
let file: string | undefined
let fileFailed = false

/** True when `--verbose` (or REDCODE_VERBOSE=1) asked for the trace to be written. */
export function enabled() {
  const value = process.env.REDCODE_VERBOSE?.toLowerCase()
  return value === "1" || value === "true"
}

/** The instant the process started, shared with worker threads through the environment. */
export function start() {
  const shared = Number(process.env.REDCODE_BOOT_START)
  if (Number.isFinite(shared) && shared > 0) return shared
  const origin = Math.round(performance.timeOrigin)
  process.env.REDCODE_BOOT_START = String(origin)
  return origin
}

/** The file the trace is written to; decided once per process family and shared with workers. */
export function filePath() {
  if (file) return file
  const shared = process.env.REDCODE_VERBOSE_BOOT_FILE
  if (shared) {
    file = shared
    return file
  }
  file = path.join(Global.Path.log, `boot-${stamp()}-${process.pid}.log`)
  process.env.REDCODE_VERBOSE_BOOT_FILE = file
  return file
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
  if (fileFailed) return
  try {
    const target = filePath()
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.appendFileSync(target, line + "\n")
  } catch {
    fileFailed = true
  }
}

/**
 * Record a boot phase. Always cheap: with tracing off it pushes one small object and returns.
 * With tracing on the line goes to stderr while the terminal is still ours, and to the file.
 */
export function mark(phase: string, facts: Facts = {}) {
  const now = Date.now()
  const since = now - start()
  const entry: Mark = {
    phase,
    since,
    delta: previous === undefined ? since : now - previous,
    facts: redact(facts),
  }
  previous = now
  marks.push(entry)
  if (enabled()) flush()
  return entry
}

let written = 0

/**
 * Write every mark not yet written. The flag is parsed after the first marks are recorded, so
 * the first write under `--verbose` catches up on `process.start` rather than losing it.
 */
export function flush() {
  if (!enabled()) return
  for (; written < marks.length; written++) {
    const line = formatMark(marks[written]!)
    if (stderrOpen) process.stderr.write(line + "\n")
    append(line)
  }
}

/** Every phase recorded so far, in order. */
export function phases(): readonly Mark[] {
  return marks
}

/**
 * The terminal is about to belong to a full-screen UI: from here nothing more goes to stderr.
 * Phases keep going to the file. Returns the line telling the reader where to look, already
 * written to stderr when it was still open.
 */
export function quiet() {
  if (!stderrOpen) return
  stderrOpen = false
  if (!enabled()) return
  const now = Date.now()
  const line = `boot${thread()} ${String(now - start()).padStart(5)}ms          screen takeover; the trace continues in ${filePath()}`
  process.stderr.write(line + "\n")
  append(line)
}

/** Whether phases still print to stderr. */
export function loud() {
  return stderrOpen
}

export function summary() {
  const last = marks.at(-1)
  const total = Math.round(completed ?? last?.since ?? Date.now() - start())
  return enabled() ? `boot complete in ${total} ms; log at ${filePath()}` : `boot complete in ${total} ms`
}

/**
 * Boot is over: the screen rendered, or a command reached the point where its work begins.
 * Prints the summary once. Later marks still record (and still reach the file) but the summary
 * is never repeated.
 */
export function stop(phase = "boot.complete", facts: Facts = {}) {
  if (stopped) return summary()
  completed = mark(phase, facts).since
  stopped = true
  const line = summary()
  if (!enabled()) return line
  if (stderrOpen) process.stderr.write(line + "\n")
  append(line)
  return line
}

export function isStopped() {
  return stopped
}

/** Test seam: forget every mark and reopen stderr. */
export function reset() {
  marks.length = 0
  written = 0
  previous = undefined
  stderrOpen = true
  stopped = false
  completed = undefined
  file = undefined
  fileFailed = false
}

export * as BootTrace from "./boot-trace"
