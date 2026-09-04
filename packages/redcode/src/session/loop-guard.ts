/**
 * Noticing when the model has stopped making progress and is just repeating itself.
 *
 * The detector this replaces compared the last three *parts* of one assistant message and required
 * byte-identical serialized input. A single interleaved text or reasoning part — which reasoning
 * models emit constantly — reset it permanently, it could not see a loop that spanned steps, and
 * when it did fire it asked the user a question whose wait had no bound: the only defence against
 * a loop was itself a way to hang.
 *
 * What counts as a loop here is narrower and more honest: the same tool, the same arguments, and
 * the same result, several times running. Identical calls that return *different* results are how
 * polling looks, and are left alone. Nothing about this needs a person.
 */

export interface Limits {
  /** Calls in a row before the model is told, in its own transcript, that it is repeating itself. */
  readonly correctAt: number
  /** Calls in a row before the turn ends. Reached only if the correction was ignored. */
  readonly stopAt: number
}

export const LIMITS: Limits = { correctAt: 3, stopAt: 5 }

export function limits(config?: false | { correct_at?: number; stop_at?: number }): Limits | undefined {
  if (config === false) return undefined
  const correctAt = config?.correct_at ?? LIMITS.correctAt
  const stopAt = config?.stop_at ?? LIMITS.stopAt
  if (correctAt <= 1) return undefined
  return { correctAt, stopAt: Math.max(stopAt, correctAt) }
}

/** The shape this needs from a message part. Anything that is not a settled tool call is skipped. */
export interface Part {
  readonly type: string
  readonly tool?: string
  readonly state?: { readonly status: string; readonly input?: unknown; readonly output?: string; readonly error?: string }
}

export type Decision =
  | { readonly type: "ok" }
  | { readonly type: "correct"; readonly streak: number; readonly message: string }
  | { readonly type: "stop"; readonly streak: number; readonly message: string }

/**
 * A call this guard already refused.
 *
 * Its result is the correction, not the tool's answer, so it must not be compared against the
 * answers around it — otherwise the guard's own message would look like the world changing and
 * would reset the streak it just started.
 */
const refused = (text: string) => text.startsWith(REFUSAL)

const REFUSAL = "This is call "

const settled = (part: Part) => part.type === "tool" && (part.state?.status === "completed" || part.state?.status === "error")
const result = (part: Part) => part.state?.output ?? part.state?.error ?? ""

/**
 * How many times in a row this exact call has already been made and answered the same way.
 *
 * Walks backwards over settled tool calls only, so text and reasoning between calls do not break
 * the chain, and a loop that spans several steps is still visible. Stops at the first call that
 * differs in tool, arguments, or result — a different result means the world moved, which is
 * polling rather than repetition.
 */
export function streak(parts: readonly Part[], next: { tool: string; input: unknown }): number {
  const wanted = JSON.stringify(next.input ?? null)
  let count = 0
  let last: string | undefined
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]!
    if (!settled(part)) continue
    if (part.tool !== next.tool) break
    if (JSON.stringify(part.state?.input ?? null) !== wanted) break
    const out = result(part)
    if (refused(out)) {
      count++
      continue
    }
    if (last !== undefined && out !== last) break
    last = out
    count++
  }
  return count
}

export function assess(input: {
  parts: readonly Part[]
  next: { tool: string; input: unknown }
  limits?: Limits
}): Decision {
  if (!input.limits) return { type: "ok" }
  // The call about to be made is part of the run, so a streak of two prior calls makes this the third.
  const count = streak(input.parts, input.next) + 1
  if (count >= input.limits.stopAt) return { type: "stop", streak: count, message: stopped(input.next, count) }
  if (count >= input.limits.correctAt) return { type: "correct", streak: count, message: correction(input.parts, input.next, count) }
  return { type: "ok" }
}

const args = (input: unknown) => {
  const text = JSON.stringify(input ?? null)
  return text.length > 400 ? text.slice(0, 400) + "…" : text
}

const lastResult = (parts: readonly Part[], next: { tool: string }) => {
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]!
    if (!settled(part) || part.tool !== next.tool) continue
    const text = result(part)
    // Quote the tool's own answer, never this guard's earlier correction.
    if (refused(text)) continue
    return text.length > 400 ? text.slice(0, 400) + "…" : text
  }
  return ""
}

/**
 * Quote the model back to itself.
 *
 * A bare "you are looping" leaves the model to guess what it did; naming the arguments and the
 * answer it keeps getting, and saying plainly what the ways out are, is what turns the notice into
 * something it can act on.
 */
export function correction(parts: readonly Part[], next: { tool: string; input: unknown }, count: number) {
  const answer = lastResult(parts, next)
  return [
    `${REFUSAL}${count} of \`${next.tool}\` with identical arguments, and every one of them returned the same thing.`,
    `arguments: ${args(next.input)}`,
    answer ? `result: ${answer}` : undefined,
    `The call was not run this time, because running it again cannot produce anything new. Change the arguments, use a different tool, or tell the user what is blocking you and stop.`,
  ]
    .filter(Boolean)
    .join("\n")
}

export function stopped(next: { tool: string }, count: number) {
  return `Stopped: \`${next.tool}\` was called ${count} times in a row with the same arguments and the same result, and the earlier warning did not change anything.`
}

export * as LoopGuard from "./loop-guard"
