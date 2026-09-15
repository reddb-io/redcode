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

import { LOOP_GUARD_PAUSE, LOOP_GUARD_REFUSAL } from "./loop-marker"

export interface Limits {
  /** Calls in a row before the model is told, in its own transcript, that it is repeating itself. */
  readonly correctAt: number
  /** Calls in a row before the turn ends. Reached only if the correction was ignored. */
  readonly stopAt: number
  /**
   * Identical calls in a row before the model is told so even though the answers keep differing.
   *
   * Comparing results is what keeps polling out of trouble, and it is also a way through: an
   * answer carrying a timestamp, a pid, or a temporary path never repeats byte for byte, so the
   * same call can run forever without ever counting as repetition. Well above any reasonable poll,
   * and it only ever says something — it never ends the turn.
   */
  readonly nudgeAt: number
  /**
   * Failed todowrite calls in a turn, with no successful one since, before the turn ends.
   *
   * The same-failure streak only corrects, and a model that varies a malformed call never repeats
   * an error for it to see; without this bound such a turn could spin until the budget ran out.
   */
  readonly failureStopAt: number
}

export const LIMITS: Limits = { correctAt: 3, stopAt: 5, nudgeAt: 12, failureStopAt: 8 }

export function limits(
  config?: false | { correct_at?: number; stop_at?: number; nudge_at?: number },
): Limits | undefined {
  if (config === false) return undefined
  const correctAt = config?.correct_at ?? LIMITS.correctAt
  const stopAt = config?.stop_at ?? LIMITS.stopAt
  const nudgeAt = config?.nudge_at ?? LIMITS.nudgeAt
  if (correctAt <= 1) return undefined
  return {
    correctAt,
    stopAt: Math.max(stopAt, correctAt),
    nudgeAt: Math.max(nudgeAt, correctAt),
    failureStopAt: Math.max(LIMITS.failureStopAt, correctAt),
  }
}

/** The shape this needs from a message part. Anything that is not a settled tool call is skipped. */
export interface Part {
  readonly type: string
  readonly tool?: string
  readonly synthetic?: boolean
  readonly state?: {
    readonly status: string
    readonly input?: unknown
    readonly output?: string
    readonly error?: string
  }
}

/**
 * The parts of the current turn, cut at the last thing the user actually said.
 *
 * A todo continuation or a goal CONTINUE is a synthetic user message the runtime writes for itself;
 * cutting there would forget the failed calls that made the runtime nudge the model, which is
 * exactly the streak this guard exists to see.
 */
export function turn<M extends { readonly info: { readonly role: string }; readonly parts: readonly Part[] }>(
  messages: readonly M[],
): Part[] {
  const last = messages.findLastIndex(
    (item) => item.info.role === "user" && !item.parts.every((part) => part.type === "text" && part.synthetic),
  )
  return messages.slice(last + 1).flatMap((item) => item.parts)
}

export type Decision =
  | { readonly type: "ok" }
  | { readonly type: "correct"; readonly streak: number; readonly message: string }
  | {
      readonly type: "stop"
      readonly streak: number
      /** The model-facing refusal, returned as the tool's error. */
      readonly message: string
      /** A short account for people, recorded as the reason an active goal was paused. */
      readonly summary: string
    }

/**
 * A call this guard already refused.
 *
 * Its result is the correction, not the tool's answer, so it must not be compared against the
 * answers around it — otherwise the guard's own message would look like the world changing and
 * would reset the streak it just started.
 */
const refused = (text: string) => text.startsWith(REFUSAL)

/** Shared with the evidence gate, which must not count a correction quoting its refusal as one. */
const REFUSAL = LOOP_GUARD_REFUSAL

/** Arguments compared by value: the same keys in another order are the same call. */
const stable = (value: unknown): string =>
  JSON.stringify(value ?? null, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  )

const settled = (part: Part) =>
  part.type === "tool" && (part.state?.status === "completed" || part.state?.status === "error")
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
  const wanted = stable(next.input)
  let count = 0
  let last: string | undefined
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]!
    if (!settled(part)) continue
    if (part.tool !== next.tool) break
    if (stable(part.state?.input) !== wanted) break
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

/**
 * The same call, made again and again, whatever came back.
 *
 * Counted only to notice a call that never stops being made; a differing answer still keeps it out
 * of `streak`, which is what decides a correction or a stop.
 */
export function repeats(parts: readonly Part[], next: { tool: string; input: unknown }): number {
  const wanted = stable(next.input)
  let count = 0
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]!
    if (!settled(part)) continue
    if (part.tool !== next.tool) break
    if (stable(part.state?.input) !== wanted) break
    count++
  }
  return count
}

/**
 * Tools whose identical failure across drifting arguments is itself the loop.
 *
 * Only todowrite: its evidence refusals repeat word for word while the model reshuffles callIDs.
 * Other tools fail the same way for legitimate reasons while the model is making progress — three
 * different edits that each miss their oldString are three attempts, not one repeated.
 */
const FAILURE_STREAK_TOOLS = new Set(["todowrite"])

/**
 * How many times in a row todowrite has just failed the same way, whatever the arguments were.
 *
 * A model that keeps being refused for the same reason usually reshuffles its arguments between
 * attempts, so byte-identical input never lines up; the refusal text does. Only settled error
 * results count, and the guard's own refusals are part of the run it is measuring. Always zero for
 * any other tool.
 */
export function failures(parts: readonly Part[], next: { tool: string }): number {
  if (!FAILURE_STREAK_TOOLS.has(next.tool)) return 0
  let count = 0
  let last: string | undefined
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]!
    if (!settled(part)) continue
    if (part.tool !== next.tool) break
    const out = result(part)
    if (refused(out)) {
      count++
      continue
    }
    if (part.state?.status !== "error" || !out) break
    if (last !== undefined && out !== last) break
    last = out
    count++
  }
  return count
}

/**
 * Failed todowrite calls in this turn since its last successful one, whatever the errors said and
 * whatever other tools ran in between. The guard's own refusals are failures too.
 */
export function todoFailures(parts: readonly Part[]): number {
  let count = 0
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]!
    if (!settled(part) || part.tool !== "todowrite") continue
    if (part.state?.status !== "error") break
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
  const same = streak(input.parts, input.next) + 1
  // A same-failure streak only corrects: the task gate blocks the task on its own after two genuine
  // refusals, so ending the turn over it would stop work the model could still do. What does end the
  // turn is a long run of todowrite failures of any kind, which no correction has broken.
  const failed = FAILURE_STREAK_TOOLS.has(input.next.tool) ? failures(input.parts, input.next) + 1 : 0
  if (same >= input.limits.stopAt)
    return {
      type: "stop",
      streak: same,
      message: stopped(input.next, same),
      summary: `${LOOP_GUARD_PAUSE}the same \`${input.next.tool}\` call repeated ${same} times`,
    }
  if (FAILURE_STREAK_TOOLS.has(input.next.tool)) {
    const run = todoFailures(input.parts)
    if (run >= input.limits.failureStopAt)
      return {
        type: "stop",
        streak: run,
        message: failureStopped(run),
        summary: `${LOOP_GUARD_PAUSE}task updates kept failing (${run} in a row)`,
      }
  }
  const count = Math.max(same, failed)
  if (count >= input.limits.correctAt)
    return {
      type: "correct",
      streak: count,
      message: correction(input.parts, input.next, count, failed > same),
    }
  // Said once, at the threshold rather than after it: a call whose answer keeps changing is
  // allowed to be made again, and being told about it every time from then on would be noise.
  const made = repeats(input.parts, input.next) + 1
  if (made === input.limits.nudgeAt) return { type: "correct", streak: made, message: nudge(input.next, made) }
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
export function correction(
  parts: readonly Part[],
  next: { tool: string; input: unknown },
  count: number,
  sameFailure = false,
) {
  const answer = lastResult(parts, next)
  return [
    sameFailure
      ? `${REFUSAL}${count} of \`${next.tool}\`, and every one of them failed with the same error even though the arguments changed.`
      : `${REFUSAL}${count} of \`${next.tool}\` with identical arguments, and every one of them returned the same thing.`,
    `arguments: ${args(next.input)}`,
    answer ? `result: ${answer}` : undefined,
    sameFailure
      ? `The call was not run this time, because reshuffling the arguments has not changed the answer. Read the error, do what it asks with other tools first, or tell the user what is blocking you and stop.`
      : `The call was not run this time, because running it again cannot produce anything new. Change the arguments, use a different tool, or tell the user what is blocking you and stop.`,
  ]
    .filter(Boolean)
    .join("\n")
}

/**
 * For the call that keeps being made while the answer keeps changing.
 *
 * Not an accusation of looping — polling looks exactly like this and is sometimes right — so it
 * asks rather than refuses, and the call still runs.
 */
export function nudge(next: { tool: string; input: unknown }, count: number) {
  return [
    `You have called \`${next.tool}\` ${count} times in a row with the same arguments: ${args(next.input)}`,
    `The answer has been different each time, so this has been left alone, but nothing else has`,
    `happened in this turn either. If you are waiting for something, say what and wait for it`,
    `deliberately; if you are not, do something else.`,
  ].join("\n")
}

export function stopped(next: { tool: string }, count: number) {
  return `Stopped: \`${next.tool}\` was called ${count} times in a row with the same result, and the earlier warning did not change anything.`
}

export function failureStopped(count: number) {
  return `Stopped: ${count} todowrite calls in a row have failed in this turn, and the corrections did not change anything. The task list was left as it is. Tell the user which task could not be updated and why, instead of retrying it.`
}

export * as LoopGuard from "./loop-guard"
