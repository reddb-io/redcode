/**
 * Time a tool call spends waiting on a person: its questions and its permission prompts.
 *
 * The tool deadline subtracts this, so a call that asks something (plan_exit's approval, for one) is
 * not stopped as wedged while the user is still reading. Waits count while they are in flight,
 * because the deadline is checked while the call is still running. Overlapping waits (a question and
 * a permission prompt open together) are merged, so wall time is subtracted once.
 *
 * Keyed by session and call: providers such as OpenAI-compatible servers and Ollama reuse call IDs
 * like `call_0`, so a parent turn and its subagent can hold the same one. Only a running tool call
 * claims an entry. A wait outside one (a question from another runtime, say) records nothing, so
 * nothing is left behind.
 */
type Interval = { start: number; end?: number }

const calls = new Map<string, Interval[]>()

const key = (sessionID: string, callID: string) => JSON.stringify([sessionID, callID])

export function claim(sessionID: string, callID: string) {
  if (!callID) return
  calls.set(key(sessionID, callID), [])
}

export function start(sessionID: string, callID: string, now = Date.now()) {
  const intervals = callID ? calls.get(key(sessionID, callID)) : undefined
  if (!intervals) return () => {}
  const interval: Interval = { start: now }
  intervals.push(interval)
  return (end = Date.now()) => {
    interval.end ??= Math.max(interval.start, end)
  }
}

export function waited(sessionID: string, callID: string, now = Date.now()) {
  const intervals = calls.get(key(sessionID, callID))
  if (!intervals?.length) return 0
  const spans = intervals
    .map((interval) => [interval.start, Math.max(interval.start, interval.end ?? now)] as const)
    .toSorted((a, b) => a[0] - b[0])
  let total = 0
  let [from, to] = spans[0]!
  for (const [begin, finish] of spans.slice(1)) {
    if (begin > to) {
      total += to - from
      from = begin
      to = finish
      continue
    }
    to = Math.max(to, finish)
  }
  return total + (to - from)
}

export function forget(sessionID: string, callID: string) {
  calls.delete(key(sessionID, callID))
}

export * as HumanWait from "./human-wait"
