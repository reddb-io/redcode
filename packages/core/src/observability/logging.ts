import { Effect, Formatter, Logger, References, type LogLevel } from "effect"
import path from "path"
import { Global } from "../global"
import { runID } from "./shared"
import { BootTrace } from "./boot-trace"
import { Verbose } from "./verbose"
import { LogFile } from "./log-file"
import { Redact } from "./redact"

export const filePath = () => path.join(Global.Path.log, "redcode.log")

function formatter(id: string = runID) {
  return Logger.map(Logger.formatStructured, (output) => {
    const messages = Array.isArray(output.message) ? output.message : [output.message]
    return [
      ["timestamp", output.timestamp],
      ["level", output.level],
      ["run", id],
      ...messages.flatMap((value) => (plain(value) ? flatten(value) : [["message", value] as const])),
      ...(output.cause === undefined ? [] : [["cause", output.cause] as const]),
      ...flatten(output.spans),
      ...flatten(output.annotations),
    ]
      .map(([key, value]) => `${key}=${format(Redact.redact(value, key))}`)
      .join(" ")
  })
}

function flatten(
  input: Record<string, unknown>,
  prefix = "",
  seen = new WeakSet<object>(),
): Array<readonly [string, unknown]> {
  if (seen.has(input)) return [[prefix, "[Circular]"]]
  seen.add(input)
  const entries = Object.entries(input)
  if (entries.length === 0 && prefix) return [[prefix, input]]
  return entries.flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    const safe = Redact.redact(value, key)
    return plain(safe) ? flatten(safe, path, seen) : [[path, safe] as const]
  })
}

function plain(input: unknown): input is Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return false
  const prototype = Object.getPrototypeOf(input)
  return prototype === Object.prototype || prototype === null
}

function format(input: unknown) {
  const value = Redact.text(typeof input === "string" ? input : Formatter.format(input))
  return /^[^\s="\\]+$/.test(value) ? value : JSON.stringify(value)
}

export function fileLogger(file = filePath(), id: string = runID) {
  // A nonzero batch window avoids idle CPU spin. Scope closure awaits the final batch.
  return Logger.batched(formatter(id), {
    window: 1000,
    flush: (entries) => Effect.promise(() => LogFile.append(file, entries)).pipe(Effect.asVoid, Effect.uninterruptible),
  })
}

/** The CLI catch runs outside the Effect runtime; await this before process.exit(). */
export async function fatal(error: unknown, file = filePath()) {
  return LogFile.append(file, [
    `timestamp=${new Date().toISOString()} level=ERROR run=${runID} event=process.fatal cause=${format(Redact.redact(error))}`,
  ])
}

const stderrLogger = Logger.make((options) => process.stderr.write(formatter().log(options) + "\n"))

// `--verbose` without `--print-logs`: only the activity trace reaches stderr, in a short form the
// eye can follow — the full structured line is in the file. Entries are the ones `Verbose.log`
// annotated; everything else stays where it was.
const verboseStderrLogger = Logger.make((options) => {
  const annotations = options.fiber.getRef(References.CurrentLogAnnotations)
  const event = annotations[Verbose.ANNOTATION]
  if (typeof event !== "string") return
  const messages = Array.isArray(options.message) ? options.message : [options.message]
  const facts = messages
    .filter(plain)
    .flatMap((value) => flatten(value))
    .map(([key, value]) => `${key}=${format(Redact.redact(value, key))}`)
    .join(" ")
  const since = String(Math.round(options.date.getTime() - BootTrace.start())).padStart(6)
  process.stderr.write(`verbose ${since}ms ${event}${facts ? " " + facts : ""}\n`)
})

export function minimumLogLevel() {
  const value = process.env.REDCODE_LOG_LEVEL?.toUpperCase()
  const levels = {
    DEBUG: "Debug",
    INFO: "Info",
    WARN: "Warn",
    ERROR: "Error",
  } as const satisfies Record<string, LogLevel.LogLevel>
  if (value && value in levels) return levels[value as keyof typeof levels]
  // The activity trace is DEBUG; asking for it without naming a level means asking for that level.
  return Verbose.enabled() ? levels.DEBUG : levels.INFO
}

export function loggers() {
  if (process.env.REDCODE_PRINT_LOGS === "1") return [fileLogger(), stderrLogger]
  if (Verbose.stderr()) return [fileLogger(), verboseStderrLogger]
  return [fileLogger()]
}

export * as Logging from "./logging"
