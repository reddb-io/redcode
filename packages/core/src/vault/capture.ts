export * as VaultCapture from "./capture.js"

import { Effect, Option, Schema } from "effect"
import { SafeRegex } from "../safe-regex.js"

/**
 * The part of a command's output a `capture` names, for values no secret pattern recognizes: the whole output,
 * trimmed (`stdout`), a JSON path (`json:$.data.token`), or the first group of a pattern (`regex:token=(\S+)`),
 * which runs off the main thread like every model-written pattern. A failure says why and never quotes the output.
 */
export type Selection = { readonly value: string } | { readonly failure: string }

/** The most output an explicit capture reads. */
export const MAX_BYTES = 1_048_576

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
const SEGMENT = /\.([A-Za-z_$][\w$-]{0,127})|\[(\d{1,9})\]|\[(["'])([^"'\]]{0,256})\3\]/y

export const select = (output: string, from: string): Effect.Effect<Selection> => {
  if (from === "stdout") return Effect.succeed(present(output.trim(), "the output is empty"))
  if (from.startsWith("json:")) return Effect.succeed(json(output, from.slice(5).trim()))
  if (from.startsWith("regex:")) return regex(output, from.slice(6))
  return Effect.succeed({
    failure: `"${from}" is not a capture source; use "stdout", "json:$.path" or "regex:<pattern with one group>"`,
  })
}

function json(output: string, path: string): Selection {
  const parsed = decodeJson(output.trim())
  if (Option.isNone(parsed)) return { failure: "the output is not JSON" }
  const steps = parse(path.startsWith("$") ? path : `$.${path}`)
  if (steps === undefined) return { failure: `${path} is not a JSON path such as $.data.token or $.items[0].key` }
  let current: unknown = parsed.value
  let at = "$"
  for (const step of steps) {
    const next = child(current, step)
    const label = `${at}${typeof step === "number" ? `[${step}]` : `.${step}`}`
    if (next === undefined) return { failure: `${label} is not in the output; ${at} holds ${shape(current)}` }
    current = next.value
    at = label
  }
  if (typeof current === "string") return present(current, `${path} is an empty string`)
  if (typeof current === "number" || typeof current === "boolean") return { value: String(current) }
  return { failure: `${path} selects ${shape(current)}, not a string` }
}

function parse(path: string) {
  const steps: Array<string | number> = []
  let index = 1
  while (index < path.length) {
    SEGMENT.lastIndex = index
    const match = SEGMENT.exec(path)
    if (!match) return undefined
    steps.push(match[1] ?? (match[2] === undefined ? match[4] : Number(match[2])))
    index = SEGMENT.lastIndex
  }
  return steps
}

function child(value: unknown, step: string | number) {
  if (typeof step === "number") return Array.isArray(value) && step < value.length ? { value: value[step] } : undefined
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const entry = Object.entries(value).find(([key]) => key === step)
  return entry === undefined ? undefined : { value: entry[1] }
}

/** What a JSON value is, without its content: the keys of an object, the length of an array, the type otherwise. */
function shape(value: unknown) {
  if (Array.isArray(value)) return `an array of ${value.length}`
  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value)
    return keys.length === 0 ? "an empty object" : `an object with keys ${keys.slice(0, 20).join(", ")}`
  }
  return value === null ? "null" : `a ${typeof value}`
}

function present(value: string, reason: string): Selection {
  return value ? { value } : { failure: reason }
}

const regex = (output: string, source: string) =>
  Effect.promise(() => SafeRegex.exec(source, output)).pipe(
    Effect.map((outcome): Selection => {
      if ("timedOut" in outcome) return { failure: `the pattern ran longer than ${SafeRegex.MATCH_TIMEOUT_MS} ms` }
      if ("error" in outcome) return { failure: `the pattern is invalid: ${outcome.error}` }
      if (outcome.match === undefined) return { failure: "the pattern did not match the output" }
      if (outcome.group === undefined) return { failure: "the pattern needs one capture group around the secret" }
      return present(outcome.group, "the capture group matched nothing")
    }),
  )
