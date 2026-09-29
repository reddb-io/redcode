// The boot trace: one mark per phase from process start until the TUI takes the terminal over.
//
// Every mark is recorded in memory whatever the flags say, so `debug startup` prints the same list
// `--verbose` streams. Writing is what `--verbose` (or REDCODE_VERBOSE=1) turns on: each mark goes
// to stderr as it happens, then the whole trace goes to the log once boot completes.
//
// The flag lives in this module rather than the environment, so the background service, a
// standalone server or anything a tool spawns does not inherit it.
import { EOL } from "node:os"

export interface Mark {
  readonly phase: string
  /** Milliseconds since the process started. */
  readonly since: number
  /** Milliseconds since the previous mark. */
  readonly delta: number
  readonly facts: Readonly<Record<string, string | number | boolean>>
}

export type Facts = Readonly<Record<string, string | number | boolean | undefined>>

const marks: Mark[] = []
let verbose = ["1", "true"].includes(process.env.OPENCODE_VERBOSE?.toLowerCase() ?? "")
let completed = false

/** True when `--verbose` or REDCODE_VERBOSE=1 asked for the trace to be written. */
export function enabled() {
  return verbose
}

/** Marks recorded before the flag was parsed are printed now, so the trace starts at process start. */
export function enable() {
  if (verbose) return
  verbose = true
  if (!completed) marks.forEach((entry) => process.stderr.write(format(entry) + EOL))
}

/** Records a phase; under `--verbose` it is printed right away, until boot completes. */
export function mark(phase: string, facts: Facts = {}) {
  const since = performance.now()
  const entry: Mark = {
    phase,
    since,
    delta: since - (marks.at(-1)?.since ?? 0),
    facts: Object.fromEntries(
      Object.entries(facts).filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined),
    ),
  }
  if (completed) return entry
  marks.push(entry)
  if (verbose) process.stderr.write(format(entry) + EOL)
  return entry
}

export function phases(): readonly Mark[] {
  return marks
}

/**
 * The terminal is about to be taken over: stderr is no longer ours to write. Returns the full
 * trace so the caller can log it; later marks are ignored.
 */
export function complete(log: string) {
  const last = mark("boot.complete")
  completed = true
  if (verbose) process.stderr.write(`boot complete in ${Math.round(last.since)} ms; log at ${log}${EOL}`)
  return marks
}

export function format(mark: Mark) {
  const facts = Object.entries(mark.facts)
    .map((entry) => `${entry[0]}=${entry[1]}`)
    .join(" ")
  return `[boot] ${ms(mark.since).padStart(7)} ${`+${ms(mark.delta)}`.padStart(8)} ${mark.phase}${facts ? ` ${facts}` : ""}`
}

const ms = (value: number) => `${Math.round(value)}ms`

export * as BootTrace from "./boot-trace"
