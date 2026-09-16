// Activity tracing behind `--verbose`: a compact, structured record of what the runtime is doing
// after boot — provider requests, tool calls, compaction, guard trips, inbox promotions.
//
// Every entry is a DEBUG log carrying the `verbose=<event>` annotation, so the file log stays one
// stream and `grep verbose= redcode.log` finds the trace. The person asked for these entries, so
// they pass whatever minimum level the rest of the log runs at. With the flag off `log` returns
// `Effect.void` before touching its fields: callers pass a thunk when the fields cost anything.
//
// Nothing here carries a message body, an argument, an output or a credential — sizes, names,
// counts and durations only. Use `redact` for anything whose keys come from outside.
import { Effect, References } from "effect"
import { BootTrace, redact, type Facts } from "./boot-trace"

export const ANNOTATION = "verbose"

export function enabled() {
  return BootTrace.enabled()
}

/**
 * Mirror verbose entries to stderr as well as the file. Only commands without a screen of their
 * own (`run`, `serve`) want this; the TUI turns the mirror off before it starts.
 */
export function stderr() {
  return BootTrace.enabled() && BootTrace.mirror()
}

type Fields = Facts | (() => Facts)

export function log(event: string, fields: Fields = {}): Effect.Effect<void> {
  if (!BootTrace.enabled()) return Effect.void
  const facts = redact(typeof fields === "function" ? fields() : fields)
  return Effect.logDebug(event, facts).pipe(
    Effect.annotateLogs({ [ANNOTATION]: event }),
    // Asked for explicitly, so a stricter --log-level does not swallow the trace.
    Effect.provideService(References.MinimumLogLevel, "Debug"),
  )
}

/** Byte length of whatever a tool returned, without keeping or printing any of it. */
export function size(value: unknown): number {
  if (value === undefined || value === null) return 0
  if (typeof value === "string") return Buffer.byteLength(value)
  try {
    return Buffer.byteLength(JSON.stringify(value))
  } catch {
    return 0
  }
}

export * as Verbose from "./verbose"
